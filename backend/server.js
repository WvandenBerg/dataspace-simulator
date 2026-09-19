/**
 * server.js — Dataspace Simulator Backend
 *
 * Local single-user tool. No sessions, no network participants, no heartbeat.
 * All state (nodes, assets, policies, negotiations, transfers) lives in SQLite.
 * Semantic metadata is indexed in Apache Fuseki via SPARQL.
 *
 * Nodes = canvas participants (identified by a local node_id, not a network BPN).
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const scenarios = require('./scenarios');
const { evaluatePolicyAgainstClaims, filterAssetsByClaims } = require('./policy');
const {
    upsertSemanticDataset,
    deleteSemanticDataset,
    deleteSemanticDatasetsForParticipant,
    semanticSearch
} = require('./semantic');
const { initiateNegotiation, advanceNegotiation, initiateTransfer } = require('./state-machine');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(bodyParser.json());

app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// ============================================================
// Health
// ============================================================

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'local-simulator' });
});

// ============================================================
// Seed predefined system policies (run on every start, idempotent)
// ============================================================

const PREDEFINED_POLICIES = [
    {
        policy_id: 'sys-open',
        name: 'Open Access',
        description: 'No restrictions — every node can access this asset.',
        constraint_operand: 'And',
        constraints: [],
    },
    {
        policy_id: 'sys-did-group',
        name: 'DID Group',
        description: 'Only nodes whose DID is explicitly listed may access.',
        constraint_operand: 'Or',
        constraints: [
            { key: 'cx-policy:consumerDid', operator: 'In', value: 'did:web:example.com' }
        ],
    },
    {
        policy_id: 'sys-industry',
        name: 'Industry Restriction',
        description: 'Restricted to nodes in a specific industry sector.',
        constraint_operand: 'Or',
        constraints: [
            { key: 'cx-policy:industry', operator: 'In', value: 'construction' }
        ],
    },
    {
        policy_id: 'sys-role',
        name: 'Role Restriction',
        description: 'Restricted to nodes with a specific organisational role.',
        constraint_operand: 'Or',
        constraints: [
            { key: 'cx-policy:orgRole', operator: 'In', value: 'contractor' }
        ],
    },
];

function seedPolicies() {
    for (const p of PREDEFINED_POLICIES) {
        // Only seed if not already present (so user edits to the value survive restarts)
        const existing = db.getPolicy(p.policy_id);
        if (!existing) {
            db.upsertPolicy(p);
            console.log(`[Seed] Policy seeded: ${p.name}`);
        }
    }
}

// The demo scenario is seeded on every start so a fresh volume is never empty.
const DEMO_SCENARIO = scenarios.getScenario(scenarios.DEFAULT_SCENARIO_ID);
const DEMO_DATASPACE_ID = 'demo';

async function seedDemoAssets() {
    console.log('[Seed] Ensuring demo scenario assets ...');

    let inserted = 0;
    for (const asset of DEMO_SCENARIO.assets) {
        if (db.getAsset(asset.assetId)) {
            continue;
        }
        const now = new Date().toISOString();
        const row = scenarios.toAssetRow(asset, {
            dataspaceId: DEMO_DATASPACE_ID,
            publishedAt: now,
        });

        db.insertAsset(row);
        inserted += 1;

        try {
            await upsertSemanticDataset({
                datasetId: row.asset_id,
                title: row.name,
                description: row.description,
                keywords: [],
                themes: [],
                spatial: Array.isArray(row?.dcat_fields?.spatial) ? row.dcat_fields.spatial : [],
                temporalCoverage: '',
                additionalDcat: [],
                policyName: row.policy_id,
                publisherBpn: row.owner_node_id,
                publisherName: scenarios.participantName(DEMO_SCENARIO, row.owner_node_id),
                sessionCode: DEMO_DATASPACE_ID,
                publishedAt: now,
            });
        } catch (err) {
            console.warn(`[Seed] Semantic index failed for ${row.asset_id}: ${err.message}`);
        }
    }

    if (inserted > 0) {
        console.log(`[Seed] Demo scenario initialized (${inserted} new asset(s)).`);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reindexAllAssetsToSemantic({ maxAttempts = 20, retryDelayMs = 1500 } = {}) {
    const assets = db.getAllAssets();
    if (assets.length === 0) {
        return;
    }

    let pending = [...assets];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const failed = [];

        for (const asset of pending) {
            const owner = db.getNode(asset.owner_node_id);
            const ownerName = owner?.name || scenarios.participantName(DEMO_SCENARIO, asset.owner_node_id);
            const dataspaceId = String(asset.dataspace_id || owner?.metadata?.dataspaceId || 'demo');

            try {
                await upsertSemanticDataset({
                    datasetId: asset.asset_id,
                    title: asset.name,
                    description: asset.description,
                    keywords: normalizeList(asset?.dcat_fields?.keywords),
                    themes: normalizeList(asset?.dcat_fields?.themes),
                    spatial: normalizeList(asset?.dcat_fields?.spatial),
                    temporalCoverage: asset?.dcat_fields?.temporalCoverage || '',
                    additionalDcat: asset?.dcat_fields?.additionalDcat || [],
                    policyName: asset.policy_id || '',
                    publisherBpn: asset.owner_node_id,
                    publisherName: ownerName,
                    sessionCode: dataspaceId,
                    publishedAt: asset.published_at || new Date().toISOString(),
                });
            } catch (_err) {
                failed.push(asset);
            }
        }

        if (failed.length === 0) {
            if (attempt > 1) {
                console.log(`[Seed] Semantic index recovered on retry ${attempt}.`);
            }
            return;
        }

        pending = failed;
        await sleep(retryDelayMs);
    }

    console.warn(`[Seed] Semantic index still incomplete after retries (${pending.length} asset(s) not indexed).`);
}



// ============================================================
// Nodes — canvas participants
// Fully replaces localStorage for node state.
// ============================================================

// GET all nodes
app.get('/api/nodes', (_req, res) => {
    const nodes = db.getAllNodes().map(n => ({
        ...n,
        bpn: n.metadata?.bpn || '',
    }));
    res.json(nodes);
});


// GET single node
app.get('/api/nodes/:id', (req, res) => {
    const node = db.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: 'Node not found' });
    res.json(node);
});

// Create or update node (upsert by node_id)
app.post('/api/nodes', (req, res) => {
    const { nodeId, name, x = 0, y = 0, metadata = {} } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const id = nodeId || (name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36));
    db.upsertNode({ node_id: id, name, x, y, metadata });
    res.json({ success: true, nodeId: id });
});

// Update position only (called frequently on drag-end)
app.patch('/api/nodes/:id/position', (req, res) => {
    const { x, y } = req.body;
    if (x === undefined || y === undefined) return res.status(400).json({ error: 'x and y required' });
    db.updateNodePosition(req.params.id, x, y);
    res.json({ success: true });
});

// Update node metadata
app.patch('/api/nodes/:id', (req, res) => {
    const node = db.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const updated = {
        node_id: req.params.id,
        name: req.body.name ?? node.name,
        x: req.body.x ?? node.x,
        y: req.body.y ?? node.y,
        metadata: { ...node.metadata, ...(req.body.metadata || {}) }
    };
    db.upsertNode(updated);
    res.json({ success: true });
});

// Delete node and all its assets
app.delete('/api/nodes/:id', async (req, res) => {
    const id = req.params.id;
    db.getAssetsByNode(id).forEach(async (asset) => {
        try { await deleteSemanticDataset(asset.asset_id); } catch (_) { }
    });
    db.deleteAssetsByNode(id);
    db.deleteNode(id);
    try { await deleteSemanticDatasetsForParticipant(id); } catch (_) { }
    res.json({ success: true });
});

// ============================================================
// Policies
// ============================================================

app.get('/api/policies', (_req, res) => {
    res.json(db.getAllPolicies());
});

app.get('/api/policies/:id', (req, res) => {
    const p = db.getPolicy(req.params.id);
    if (!p) return res.status(404).json({ error: 'Policy not found' });
    res.json(p);
});

app.post('/api/policies', (req, res) => {
    const { name, constraintOperand = 'And', constraints = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const policyId = req.body.policyId || uuidv4();
    db.upsertPolicy({ policy_id: policyId, name, constraint_operand: constraintOperand, constraints });
    res.json({ success: true, policyId });
});

// Policy delete — system policies are protected
app.delete('/api/policies/:id', (req, res) => {
    if (PREDEFINED_POLICIES.some(p => p.policy_id === req.params.id)) {
        return res.status(403).json({ error: 'System policies cannot be deleted.' });
    }
    db.deletePolicy(req.params.id);
    res.json({ success: true });
});


// ============================================================
// Assets
// ============================================================

app.get('/api/assets', (req, res) => {
    const { nodeId } = req.query;
    const dataspaceId = resolveDataspaceId(req.query?.dataspaceId);
    const scopedAssets = db.getAllAssets().filter((a) => String(a.dataspace_id || 'demo') === dataspaceId);
    const assets = nodeId ? scopedAssets.filter((a) => a.owner_node_id === nodeId) : scopedAssets;
    res.json(assets.map(assetToResponse));
});

app.get('/api/assets/:id', (req, res) => {
    const a = db.getAsset(req.params.id);
    if (!a) return res.status(404).json({ error: 'Asset not found' });
    res.json(assetToResponse(a));
});

app.post('/api/assets', async (req, res) => {
    const { nodeId, asset } = req.body;
    const dataspaceId = resolveDataspaceId(req.body?.dataspaceId);
    if (!nodeId || !asset?.name) return res.status(400).json({ error: 'nodeId and asset.name required' });

    const node = db.getNode(nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const assetId = asset.id || uuidv4();
    const now = new Date().toISOString();

    const row = {
        asset_id: assetId,
        dataspace_id: dataspaceId,
        owner_node_id: nodeId,
        name: String(asset.name).trim(),
        description: String(asset.description || asset?.dcatFields?.description || '').trim(),
        asset_content: typeof asset.content === 'string' ? asset.content : JSON.stringify(asset.content || ''),
        file_name: String(asset.fileName || '').trim(),
        policy_id: asset.policyId || null,
        dcat_fields: asset.dcatFields || {},
        published_at: now,
    };

    db.insertAsset(row);

    // Index in Fuseki
    try {
        await upsertSemanticDataset({
            datasetId: assetId,
            title: row.name,
            description: row.description,
            keywords: normalizeList(row.dcat_fields.keywords),
            themes: normalizeList(row.dcat_fields.themes),
            spatial: normalizeList(row.dcat_fields.spatial),
            temporalCoverage: row.dcat_fields.temporalCoverage || '',
            additionalDcat: row.dcat_fields.additionalDcat || [],
            policyName: asset.policyId || '',
            publisherBpn: nodeId,  // use nodeId as the "publisher" identifier in Fuseki
            publisherName: node.name,
            sessionCode: dataspaceId,
            publishedAt: now,
        });
    } catch (err) {
        console.error('[Semantic] Indexing failed:', err.message);
    }

    res.json({ success: true, assetId });
});

app.delete('/api/assets/:id', async (req, res) => {
    const a = db.getAsset(req.params.id);
    if (!a) return res.status(404).json({ error: 'Asset not found' });
    db.deleteAsset(req.params.id);
    try { await deleteSemanticDataset(req.params.id); } catch (_) { }
    res.json({ success: true });
});

app.put('/api/assets/:id', async (req, res) => {
    const existing = db.getAsset(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found' });

    const payload = req.body?.asset || {};
    const name = String(payload.name || existing.name || '').trim();
    if (!name) return res.status(400).json({ error: 'asset.name required' });

    const ownerNodeId = payload.ownerNodeId || existing.owner_node_id;
    const dataspaceId = resolveDataspaceId(payload.dataspaceId || req.body?.dataspaceId || existing.dataspace_id);
    const ownerNode = db.getNode(ownerNodeId);
    if (!ownerNode) return res.status(404).json({ error: 'Owner node not found' });

    const updated = {
        asset_id: existing.asset_id,
        dataspace_id: dataspaceId,
        name,
        description: String(payload.description ?? existing.description ?? '').trim(),
        asset_content: typeof payload.content === 'string'
            ? payload.content
            : (payload.content != null ? JSON.stringify(payload.content) : String(existing.asset_content || '')),
        file_name: String(payload.fileName ?? existing.file_name ?? '').trim(),
        policy_id: payload.policyId === undefined ? (existing.policy_id || null) : (payload.policyId || null),
        dcat_fields: payload.dcatFields || existing.dcat_fields || {},
    };

    db.updateAsset(updated);

    try {
        await upsertSemanticDataset({
            datasetId: existing.asset_id,
            title: updated.name,
            description: updated.description,
            keywords: normalizeList(updated.dcat_fields.keywords),
            themes: normalizeList(updated.dcat_fields.themes),
            spatial: normalizeList(updated.dcat_fields.spatial),
            temporalCoverage: updated.dcat_fields.temporalCoverage || '',
            additionalDcat: updated.dcat_fields.additionalDcat || [],
            policyName: updated.policy_id || '',
            publisherBpn: ownerNodeId,
            publisherName: ownerNode.name,
            sessionCode: dataspaceId,
            publishedAt: existing.published_at,
        });
    } catch (err) {
        console.error('[Semantic] Update indexing failed:', err.message);
    }

    const out = db.getAsset(existing.asset_id);
    res.json({ success: true, asset: assetToResponse(out) });
});

// ============================================================
// Catalog — policy-filtered view of all assets
// consumerNodeId optional: if provided, filters by node's metadata claims
// ============================================================

app.get('/api/catalog', (req, res) => {
    const { consumerNodeId, providerNodeId } = req.query;
    const dataspaceId = resolveDataspaceId(req.query?.dataspaceId);
    const all = db.getAllAssets().filter((a) => String(a.dataspace_id || 'demo') === dataspaceId);

    let visible = all;
    if (consumerNodeId) {
        const consumer = db.getNode(consumerNodeId);
        if (consumer) {
            const policyMap = buildPolicyMap(all);
            visible = filterAssetsByClaims(all, policyMap, consumer.metadata || {});
        }
    }

    if (providerNodeId) {
        visible = visible.filter((asset) => asset.owner_node_id === providerNodeId);
    }

    res.json(visible.map(a => ({
        '@type': 'dcat:Dataset',
        '@id': a.asset_id,
        name: a.name,
        description: a.description,
        ownerNodeId: a.owner_node_id,
        ownerName: db.getNode(a.owner_node_id)?.name || a.owner_node_id,
        publishedAt: a.published_at,
        policyId: a.policy_id,
        dcatFields: a.dcat_fields,
    })));
});

// ============================================================
// Semantic search (SPARQL via Fuseki)
// Policy-scoping: only search within nodes the consumer can see
// ============================================================

app.post('/api/semantic/search', async (req, res) => {
    const { searchText = '', consumerNodeId, providerNodeIds = null, dcatFilters = {}, dcatFieldFilters = [], limit = 25 } = req.body || {};
    const dataspaceId = resolveDataspaceId(req.body?.dataspaceId);

    // Catalog-first visibility: determine exactly which assets are visible
    let visibleAssets = db.getAllAssets().filter((a) => String(a.dataspace_id || 'demo') === dataspaceId);
    if (consumerNodeId) {
        const consumer = db.getNode(consumerNodeId);
        if (consumer) {
            const policyMap = buildPolicyMap(visibleAssets);
            visibleAssets = filterAssetsByClaims(visibleAssets, policyMap, consumer.metadata || {});
        }
    }

    if (Array.isArray(providerNodeIds) && providerNodeIds.length > 0) {
        const allowedOwners = new Set(providerNodeIds.map(String));
        visibleAssets = visibleAssets.filter((a) => allowedOwners.has(String(a.owner_node_id)));
    }

    const visibleDatasetIds = [...new Set(visibleAssets.map(a => a.asset_id).filter(Boolean))];
    if (visibleDatasetIds.length === 0) {
        return res.json({ success: true, results: [], mode: 'catalog-first-fuseki' });
    }

    try {
        const rawResults = await semanticSearch({
            searchText,
            sessionCode: dataspaceId,
            datasetIds: visibleDatasetIds,
            dcatFilters,
            dcatFieldFilters,
            limit: Math.min(Number(limit) || 25, 100),
        });

        const bpnToNodeId = new Map(
            db.getAllNodes()
                .filter((n) => n?.metadata?.bpn)
                .map((n) => [String(n.metadata.bpn).toLowerCase(), n.node_id])
        );

        const results = rawResults.map((result) => ({
            ...result,
            publisherNodeId: bpnToNodeId.get(String(result.publisherBpn || '').toLowerCase()) || result.publisherBpn,
        }));
        res.json({ success: true, results, mode: 'catalog-first-fuseki' });
    } catch (err) {
        console.error('[Semantic] Search failed:', err.message);
        res.status(502).json({ success: false, error: 'Semantic search failed', details: err.message });
    }
});

// ============================================================
// Negotiations
// ============================================================

app.post('/api/negotiate', (req, res) => {
    const { consumerNodeId, providerNodeId, assetId } = req.body;
    const dataspaceId = resolveDataspaceId(req.body?.dataspaceId);
    if (!consumerNodeId || !providerNodeId || !assetId) {
        return res.status(400).json({ error: 'consumerNodeId, providerNodeId, assetId required' });
    }
    const asset = db.getAsset(assetId);
    if (!asset) return res.status(404).json({ success: false, error: 'Asset not found' });
    if (String(asset.dataspace_id || 'demo') !== dataspaceId) {
        return res.status(400).json({ success: false, error: 'Asset is not in active dataspace' });
    }
    const result = initiateNegotiation({ consumerNodeId, providerNodeId, assetId });
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, ...result });
});

app.get('/api/negotiate/:id', (req, res) => {
    const neg = db.getNegotiation(req.params.id);
    if (!neg) return res.status(404).json({ error: 'Not found' });
    res.json(neg);
});

app.post('/api/negotiate/:id/advance', (req, res) => {
    const { action } = req.body;
    const result = advanceNegotiation(req.params.id, action);
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, ...result });
});

app.get('/api/negotiations', (req, res) => {
    const { consumerNodeId } = req.query;
    if (!consumerNodeId) return res.status(400).json({ error: 'consumerNodeId required' });
    res.json(db.getNegotiationsByConsumer(consumerNodeId));
});

// ============================================================
// Transfers
// ============================================================

app.post('/api/transfer', (req, res) => {
    const { negotiationId, consumerNodeId } = req.body;
    const dataspaceId = resolveDataspaceId(req.body?.dataspaceId);
    if (!negotiationId || !consumerNodeId) {
        return res.status(400).json({ error: 'negotiationId and consumerNodeId required' });
    }
    const negotiation = db.getNegotiation(negotiationId);
    if (!negotiation) return res.status(404).json({ success: false, error: 'Negotiation not found' });
    const negotiatedAsset = db.getAsset(negotiation.asset_id);
    if (!negotiatedAsset) return res.status(404).json({ success: false, error: 'Asset not found' });
    if (String(negotiatedAsset.dataspace_id || 'demo') !== dataspaceId) {
        return res.status(400).json({ success: false, error: 'Negotiation asset is not in active dataspace' });
    }
    const result = initiateTransfer({ negotiationId, consumerNodeId });
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, ...result });
});

app.get('/api/transfer/:id', (req, res) => {
    const t = db.getTransfer(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(t);
});

app.get('/api/mydata', (req, res) => {
    const { nodeId } = req.query;
    if (!nodeId) return res.status(400).json({ error: 'nodeId required' });
    res.json(db.getReceivedDataByNode(nodeId));
});

// ============================================================
// Reset — clears all assets and negotiations but keeps nodes
// ============================================================

app.post('/api/reset', async (req, res) => {
    const { keepNodes = true, keepAssets = false } = req.body || {};
    const dataspaceId = resolveDataspaceId(req.body?.dataspaceId);

    if (!keepAssets) {
        const assets = db.getAllAssets().filter((a) => String(a.dataspace_id || 'demo') === dataspaceId);
        for (const a of assets) {
            try { await deleteSemanticDataset(a.asset_id); } catch (_) { }
            db.deleteAsset(a.asset_id);
        }
    }

    if (!keepNodes) {
        db.getAllNodes()
            .filter((n) => String(n?.metadata?.dataspaceId || 'demo') === dataspaceId)
            .forEach((n) => db.deleteNode(n.node_id));
    }

    res.json({
        success: true,
        message: keepAssets
            ? (keepNodes ? 'No reset action requested' : 'Nodes reset, assets kept')
            : (keepNodes ? 'Assets reset, nodes kept' : 'Full reset')
    });
});

// ============================================================
// Helpers
// ============================================================

function normalizeList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
    return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function resolveDataspaceId(raw) {
    const id = String(raw || '').trim();
    return id || 'demo';
}

function buildPolicyMap(assets) {
    const map = new Map();
    const ids = [...new Set(assets.map(a => a.policy_id).filter(Boolean))];
    for (const id of ids) {
        const pol = db.getPolicy(id);
        if (pol) map.set(id, pol);
    }
    return map;
}

function assetToResponse(a) {
    return {
        id: a.asset_id,
        dataspaceId: a.dataspace_id || 'demo',
        name: a.name,
        description: a.description,
        content: a.asset_content || '',
        ownerNodeId: a.owner_node_id,
        fileName: a.file_name,
        policyId: a.policy_id,
        dcatFields: a.dcat_fields,
        publishedAt: a.published_at,
    };
}

// ============================================================
// Start
// ============================================================

server.listen(PORT, () => {
    seedPolicies();
    seedDemoAssets().catch((err) => {
        console.warn(`[Seed] Demo scenario failed: ${err.message}`);
    });
    reindexAllAssetsToSemantic().catch((err) => {
        console.warn(`[Seed] Semantic reindex failed: ${err.message}`);
    });
    console.log('');

    console.log('══════════════════════════════════════════════');
    console.log('  Dataspace Simulator  (local-only mode)');
    console.log('══════════════════════════════════════════════');
    console.log(`  http://localhost:${PORT}`);
    console.log(`  DB:     ${process.env.DB_PATH || './data/simulator.db'}`);
    console.log(`  Fuseki: ${process.env.FUSEKI_URL || 'http://sim-fuseki:3030'}`);
    console.log('══════════════════════════════════════════════');
});
