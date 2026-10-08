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
const vocabhub = require('./vocabhub');
const catalogProfiles = require('./catalogprofiles');
const validator = require('./validator');
const { assetToRecord, valuesAt } = require('./record');
const { evaluatePolicyAgainstClaims, filterAssetsByClaims } = require('./policy');
const {
    upsertSemanticDataset,
    upsertSemanticDatasets,
    deleteSemanticDataset,
    deleteSemanticDatasetsForParticipant,
    readRecords,
    semanticSearch,
    executeSelect,
    executeUpdate,
} = require('./semantic');
const { initiateNegotiation, advanceNegotiation, initiateTransfer } = require('./state-machine');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
// Profile files arrive as JSON text, and a shapes file alone can pass the 100kb default.
app.use('/api/vocabhub/profiles', bodyParser.json({ limit: '10mb' }));
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

// A fresh volume starts with the demo scenario, once; after that the demo
// dataspace is the user's to rename, reset or delete.
const DEMO_SCENARIO = scenarios.getScenario(scenarios.DEFAULT_SCENARIO_ID);
const DEMO_DATASPACE_ID = 'demo';

// Seeding writes SQLite only. Indexing is left to reindexAllAssetsToSemantic so
// that seeding never yields partway through, which is what used to let the
// reindexer start against a half-populated table.
function seedDemoDataspace() {
    db.insertDataspace({
        dataspace_id: DEMO_DATASPACE_ID,
        name: 'Demo',
        scenario_id: DEMO_SCENARIO.id,
        created_at: new Date().toISOString(),
    });
    const added = writeScenarioRows(DEMO_DATASPACE_ID, DEMO_SCENARIO);
    console.log(`[Seed] Demo dataspace created (${added.length} asset(s)).`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function indexAsset(asset) {
    await upsertSemanticDataset(datasetFor(asset));
}

function datasetFor(asset) {
    const owner = db.getNode(asset.owner_node_id);
    const ownerName = owner?.name || scenarios.participantName(DEMO_SCENARIO, asset.owner_node_id);
    const dataspaceId = String(asset.dataspace_id || owner?.metadata?.dataspaceId || 'demo');

    return {
        datasetId: asset.asset_id,
        record: recordOf(asset),
        policyName: policyLabel(asset.policy_id),
        publisherBpn: asset.owner_node_id,
        publisherName: ownerName,
        sessionCode: dataspaceId,
        publishedAt: asset.published_at || new Date().toISOString(),
    };
}

async function reindexAllAssetsToSemantic({ maxAttempts = 20, retryDelayMs = 1500 } = {}) {
    const indexed = new Set();

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        // Re-read on every attempt. A snapshot taken once at entry is how this
        // used to miss assets and still report success.
        const assets = db.getAllAssets();
        const pending = assets.filter((a) => !indexed.has(a.asset_id));

        if (pending.length === 0) {
            if (assets.length > 0 && attempt > 1) {
                console.log(`[Seed] Semantic index complete (${assets.length} asset(s)).`);
            }
            return;
        }

        for (const asset of pending) {
            // A dataspace deleted while this runs would otherwise get its graphs back.
            if (!db.getAsset(asset.asset_id)) continue;
            try {
                await indexAsset(asset);
                indexed.add(asset.asset_id);
                // Deleted while it was being written.
                if (!db.getAsset(asset.asset_id)) {
                    const dataspaceId = assetDataspaceId(asset);
                    await (db.getDataspace(dataspaceId) ? deleteSemanticDataset(asset.asset_id) : dropDataspaceGraphs(dataspaceId));
                }
            } catch (_err) {
                // Fuseki is usually just not up yet; the next attempt retries.
            }
        }

        if (db.getAllAssets().every((a) => indexed.has(a.asset_id))) {
            console.log(`[Seed] Semantic index complete (${indexed.size} asset(s)).`);
            return;
        }

        await sleep(retryDelayMs);
    }

    const total = db.getAllAssets().length;
    throw new Error(`semantic index incomplete after ${maxAttempts} attempts (${indexed.size} of ${total} asset(s) indexed)`);
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

    try {
        await indexAsset(row);
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
        // A record is the whole entry. The old form's fields were partial, so those are merged.
        dcat_fields: payload.dcatFields?.record
            ? payload.dcatFields
            : { ...(existing.dcat_fields || {}), ...(payload.dcatFields || {}) },
    };

    db.updateAsset(updated);
    const out = db.getAsset(existing.asset_id);

    try {
        await indexAsset(out);
    } catch (err) {
        console.error('[Semantic] Update indexing failed:', err.message);
    }

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
        policyName: policyLabel(a.policy_id),
        fileName: a.file_name,
        dcatFields: a.dcat_fields,
        record: recordOf(a),
    })));
});

// ============================================================
// Scenarios
// ============================================================

app.get('/api/scenarios', (_req, res) => {
    res.json(scenarios.listScenarios());
});

// Load a scenario's participants and assets into a dataspace. Idempotent:
// re-loading refreshes the participants and leaves existing assets alone.
app.post('/api/scenarios/:id/load', async (req, res) => {
    const scenario = scenarios.getScenario(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    res.json(await loadScenario(resolveDataspaceId(req.body?.dataspaceId), scenario));
});

async function loadScenario(dataspaceId, scenario) {
    const added = writeScenarioRows(dataspaceId, scenario);

    const failed = [];
    try {
        await upsertSemanticDatasets(added.map(datasetFor));
    } catch (err) {
        failed.push(...added.map((row) => ({ assetId: row.asset_id, error: err.message })));
    }

    let hubTriples = 0;
    let profileFields = 0;
    try {
        ({ tripleCount: hubTriples, profileFields } = await vocabhub.loadScenarioIntoHub(dataspaceId, scenario));
    } catch (err) {
        failed.push({ hub: true, error: err.message });
    }

    return {
        success: failed.length === 0,
        scenarioId: scenario.id,
        dataspaceId,
        participants: scenario.participants.length,
        assetsAdded: added.length,
        assetsSkipped: scenario.assets.length - added.length,
        hubTriples,
        profileFields,
        indexingFailures: failed,
    };
}

// The SQLite half of loading a scenario. Returns the assets it added.
function writeScenarioRows(dataspaceId, scenario) {
    const publishedAt = new Date().toISOString();
    // Before indexing, which tags the free-text fields with it.
    if (scenario.metadataLanguage && !db.getDataspaceSettings(dataspaceId).metadata?.language) {
        db.patchDataspaceSettings(dataspaceId, { metadata: { language: scenario.metadataLanguage } });
    }

    scenario.participants.forEach((participant, index) => {
        db.upsertNode(scenarios.toNodeRow(participant, {
            dataspaceId,
            index,
            total: scenario.participants.length,
        }));
    });

    const added = [];
    for (const asset of scenario.assets) {
        const row = scenarios.toAssetRow(asset, { dataspaceId, publishedAt });
        if (db.getAsset(row.asset_id)) continue;
        db.insertAsset(row);
        added.push(row);
    }
    return added;
}

// ============================================================
// Dataspaces
//
// The list the sidebar shows, and the scenario each one came from.
// ============================================================

const nodeDataspaceId = (n) => String(n?.metadata?.dataspaceId || 'demo');
const assetDataspaceId = (a) => String(a.dataspace_id || 'demo');
const DATASPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const MAX_NAME_LENGTH = 100;

function dataspaceToResponse(row, nodes, assets) {
    const scenario = row.scenario_id ? scenarios.getScenario(row.scenario_id) : null;
    return {
        id: row.dataspace_id,
        name: row.name,
        scenarioId: row.scenario_id,
        scenario: scenario ? { id: scenario.id, name: scenario.name, description: scenario.description || '' } : null,
        createdAt: row.created_at,
        participants: nodes.filter((n) => nodeDataspaceId(n) === row.dataspace_id).length,
        assets: assets.filter((a) => assetDataspaceId(a) === row.dataspace_id).length,
    };
}

function dataspaceResponse(dataspaceId) {
    return dataspaceToResponse(db.getDataspace(dataspaceId), db.getAllNodes(), db.getAllAssets());
}

function nameFrom(raw) {
    const name = String(raw ?? '').trim();
    return name && name.length <= MAX_NAME_LENGTH ? name : null;
}

// The scenario most of whose participants a dataspace holds. Sharing one
// participant, as two unrelated scenarios can, is not enough.
function likelyScenario(dataspaceId, nodeIds) {
    let best = null;
    let bestShare = 0.5;
    for (const { id } of scenarios.listScenarios()) {
        const scenario = scenarios.getScenario(id);
        const held = scenario.participants.filter((p) => nodeIds.has(scenarios.scopedId(dataspaceId, p.id))).length;
        const share = held / scenario.participants.length;
        if (share >= bestShare) {
            best = scenario.id;
            bestShare = share;
        }
    }
    return best;
}

// Data written under a dataspace id nobody registered still shows up in the
// list, so nothing holds data the user cannot see or delete.
function registerUnlistedDataspaces() {
    const nodes = db.getAllNodes();
    const assets = db.getAllAssets();
    const ids = new Set([...nodes.map(nodeDataspaceId), ...assets.map(assetDataspaceId), ...db.getConfiguredDataspaceIds()]);
    const nodeIds = new Set(nodes.map((n) => n.node_id));
    const createdAt = new Date().toISOString();
    const registered = [];
    for (const id of ids) {
        if (db.getDataspace(id)) continue;
        db.insertDataspace({ dataspace_id: id, name: id, scenario_id: likelyScenario(id, nodeIds), created_at: createdAt });
        registered.push(id);
    }
    return registered;
}

app.get('/api/dataspaces', (_req, res) => {
    const nodes = db.getAllNodes();
    const assets = db.getAllAssets();
    res.json(db.getAllDataspaces().map((row) => dataspaceToResponse(row, nodes, assets)));
});

// An id is accepted only to carry over dataspaces the browser used to keep itself.
app.post('/api/dataspaces', async (req, res) => {
    const name = nameFrom(req.body?.name);
    if (!name) return res.status(400).json({ error: `name required, at most ${MAX_NAME_LENGTH} characters` });

    const scenarioId = req.body?.scenarioId || null;
    const scenario = scenarioId ? scenarios.getScenario(scenarioId) : null;
    if (scenarioId && !scenario) return res.status(400).json({ error: 'Scenario not found' });

    let id = req.body?.id;
    if (id !== undefined) {
        if (typeof id !== 'string' || !DATASPACE_ID_PATTERN.test(id)) return res.status(400).json({ error: 'Invalid id' });
        if (db.getDataspace(id)) return res.status(409).json({ error: 'Dataspace exists', dataspace: dataspaceResponse(id) });
    } else {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'dataspace';
        id = `${slug}-${Date.now().toString(36)}`;
    }

    db.insertDataspace({ dataspace_id: id, name, scenario_id: scenario?.id || null, created_at: new Date().toISOString() });
    const loaded = scenario ? await loadScenario(id, scenario) : null;
    res.status(201).json({ dataspace: dataspaceResponse(id), loaded });
});

app.patch('/api/dataspaces/:id', (req, res) => {
    if (!db.getDataspace(req.params.id)) return res.status(404).json({ error: 'Dataspace not found' });
    const name = nameFrom(req.body?.name);
    if (!name) return res.status(400).json({ error: `name required, at most ${MAX_NAME_LENGTH} characters` });
    db.renameDataspace(req.params.id, name);
    res.json(dataspaceResponse(req.params.id));
});

// Fuseki goes first: if it is unreachable, nothing is removed and the user can retry.
async function clearDataspace(dataspaceId, options) {
    await dropDataspaceGraphs(dataspaceId);
    const nodeIds = db.getAllNodes().filter((n) => nodeDataspaceId(n) === dataspaceId).map((n) => n.node_id);
    db.clearDataspace(dataspaceId, nodeIds, options);
}

async function dropDataspaceGraphs(dataspaceId) {
    const ds = encodeURIComponent(dataspaceId);
    const rows = await executeSelect('SELECT DISTINCT ?g WHERE { GRAPH ?g { } }');
    const graphs = rows.map((r) => r.g.value)
        .filter((g) => g.endsWith(`:session:${ds}`) || g.startsWith(`urn:graph:vocabhub:${ds}:`));
    // One request is one write transaction; a request per graph took seconds each.
    if (graphs.length > 0) await executeUpdate(graphs.map((g) => `DROP SILENT GRAPH <${g}>`).join(' ;\n'));
}

app.delete('/api/dataspaces/:id', async (req, res) => {
    if (!db.getDataspace(req.params.id)) return res.status(404).json({ error: 'Dataspace not found' });
    try {
        await clearDataspace(req.params.id, { removeEntry: true });
    } catch (err) {
        return res.status(500).json({ error: `Could not delete: ${err.message}` });
    }
    res.json({ success: true });
});

// Back to how it was created: the scenario's contents, or empty without one.
app.post('/api/dataspaces/:id/reset', async (req, res) => {
    const row = db.getDataspace(req.params.id);
    if (!row) return res.status(404).json({ error: 'Dataspace not found' });
    const scenario = row.scenario_id ? scenarios.getScenario(row.scenario_id) : null;
    if (row.scenario_id && !scenario) return res.status(409).json({ error: `Scenario ${row.scenario_id} no longer exists` });
    try {
        await clearDataspace(row.dataspace_id);
    } catch (err) {
        return res.status(500).json({ error: `Could not reset: ${err.message}` });
    }
    const loaded = scenario ? await loadScenario(row.dataspace_id, scenario) : null;
    res.json({ dataspace: dataspaceResponse(row.dataspace_id), loaded });
});

// ============================================================
// Dataspace settings
//
// Configuration of the dataspace itself, as opposed to a view preference.
// ============================================================

function settingsPatchFrom(body, dataspaceId) {
    const hub = body?.vocabHub;
    const patch = {};
    if (hub && typeof hub === 'object') {
        const vocabHub = {};
        if (typeof hub.enabled === 'boolean') vocabHub.enabled = hub.enabled;
        if (Number.isFinite(hub.x) && Number.isFinite(hub.y)) {
            vocabHub.x = hub.x;
            vocabHub.y = hub.y;
        }
        if (Object.keys(vocabHub).length > 0) patch.vocabHub = vocabHub;
    }
    if (typeof body?.validator?.enabled === 'boolean') patch.validator = { enabled: body.validator.enabled };
    // null goes back to the default profile.
    const profileId = body?.catalog?.profileId;
    if (profileId === null || isCatalogProfile(dataspaceId, profileId)) patch.catalog = { profileId };
    return Object.keys(patch).length > 0 ? patch : null;
}

function isCatalogProfile(dataspaceId, profileId) {
    return catalogProfiles.listFileProfiles(dataspaceId)
        .some((p) => p.id === profileId && p.files.some((f) => f.role === 'validation'));
}

app.get('/api/dataspaces/:id/settings', (req, res) => {
    res.json(db.getDataspaceSettings(resolveDataspaceId(req.params.id)));
});

app.patch('/api/dataspaces/:id/settings', (req, res) => {
    const dataspaceId = resolveDataspaceId(req.params.id);
    const patch = settingsPatchFrom(req.body, dataspaceId);
    if (!patch) {
        return res.status(400).json({ error: 'Expected { vocabHub: { enabled?, x?, y? } }, { validator: { enabled } } or { catalog: { profileId } } naming a catalog profile in this hub, or null' });
    }
    res.json(db.patchDataspaceSettings(dataspaceId, patch));
});

// The fields a catalog entry has in this dataspace, and how many entries fill each.
app.get('/api/dataspaces/:id/catalog-model', async (req, res) => {
    const dataspaceId = resolveDataspaceId(req.params.id);
    try {
        const model = await catalogProfiles.catalogModel(dataspaceId, hubEnabled(dataspaceId));
        // A scenario's profile takes its title from the catalogue export, which only the hub reads.
        const title = model.source === 'hub'
            ? (await vocabhub.listCatalogProfiles(dataspaceId)).find((p) => p.id === model.profileId)?.title
            : model.title;
        const records = [...(await readRecords(dataspaceId)).values()];
        const language = db.getDataspaceSettings(dataspaceId).metadata?.language || null;
        res.json({ ...model, title: title || model.profileId, language, total: records.length, fields: catalogProfiles.withCoverage(model.fields, records) });
    } catch (err) {
        res.status(502).json({ error: `Catalog model unavailable: ${err.message}` });
    }
});

// Every entry of this dataspace checked against the catalog profile by the SHACL validator.
app.get('/api/dataspaces/:id/validation', async (req, res) => {
    const dataspaceId = resolveDataspaceId(req.params.id);
    if (!hubEnabled(dataspaceId)) return res.status(409).json({ error: NO_HUB });
    if (db.getDataspaceSettings(dataspaceId).validator?.enabled !== true) {
        return res.status(409).json({ error: 'This dataspace runs no metadata validator' });
    }
    try {
        res.json(await validator.validateCatalog(dataspaceId, true));
    } catch (err) {
        const detail = err.response?.data?.detail || err.message;
        res.status(502).json({ error: `Validator unavailable: ${detail}` });
    }
});

// ============================================================
// Vocabulary Hub
//
// One hub per dataspace. Catalogue exports come from scenario files; catalog
// profiles come from scenario files or are uploaded.
// ============================================================

const NO_HUB = 'This dataspace runs no vocabulary service';

// Only the switch is checked: whether the hub sits on the ring is canvas geometry the backend never sees.
function hubEnabled(dataspaceId) {
    return db.getDataspaceSettings(dataspaceId).vocabHub?.enabled === true;
}

function hubRoute(handler) {
    return async (req, res) => {
        const dataspaceId = resolveDataspaceId(req.query?.dataspaceId);
        if (!hubEnabled(dataspaceId)) return res.status(409).json({ error: NO_HUB });
        try {
            const result = await handler(req, dataspaceId);
            if (result === null) return res.status(404).json({ error: 'Not found in the Vocabulary Hub' });
            res.json(result);
        } catch (err) {
            if (err instanceof catalogProfiles.ProfileError) return res.status(400).json({ error: err.message });
            res.status(502).json({ error: `Vocabulary Hub unavailable: ${err.message}` });
        }
    };
}

app.get('/api/vocabhub/profiles', hubRoute((_req, ds) => vocabhub.listProfiles(ds)));

app.get('/api/vocabhub/profiles/:id', hubRoute((req, ds) => vocabhub.getProfile(ds, req.params.id)));

app.get('/api/vocabhub/shapes/:id', hubRoute((req, ds) => vocabhub.shapesFor(ds, req.params.id)));

app.get('/api/vocabhub/alignments', hubRoute((req, ds) => vocabhub.listAlignments(ds, {
    target: req.query.target,
    minCoverage: req.query.minCoverage,
})));

app.get('/api/vocabhub/catalog-profiles', hubRoute((_req, ds) => vocabhub.listCatalogProfiles(ds)));

app.get('/api/vocabhub/profiles/:id/fields', hubRoute((req, ds) => catalogProfiles.fieldModel(ds, req.params.id)));

// Uploads always create a new profile, so they cannot overwrite one a scenario ships.
app.post('/api/vocabhub/profiles', hubRoute((req, ds) => catalogProfiles.addProfile(ds, {
    title: req.body?.title,
    version: req.body?.version,
    description: req.body?.description,
    files: req.body?.files,
})));

app.patch('/api/vocabhub/profiles/:id', hubRoute((req, ds) => catalogProfiles.setDataStandard(ds, req.params.id, req.body?.dataStandardPath ?? null)));

app.delete('/api/vocabhub/profiles/:id', hubRoute(async (req, ds) => {
    if (db.getHubProfile(ds, req.params.id)?.source !== 'upload') return null;
    await catalogProfiles.removeProfile(ds, req.params.id);
    return { success: true };
}));

app.get('/api/vocabhub/artifacts/:id', (req, res) => {
    const dataspaceId = resolveDataspaceId(req.query?.dataspaceId);
    if (!hubEnabled(dataspaceId)) return res.status(409).json({ error: NO_HUB });
    const artifact = catalogProfiles.artifact(dataspaceId, req.params.id);
    if (!artifact) return res.status(404).json({ error: 'Not found in the Vocabulary Hub' });
    res.type(artifact.media_type).attachment(artifact.file_name).send(artifact.content);
});

// ============================================================
// Semantic search (SPARQL via Fuseki)
// Policy-scoping: only search within nodes the consumer can see
// ============================================================

// Maps every searchable profile to how it became searchable: null for the ones
// the consumer picked, an alignment for the ones the hub reaches from them.
// One hop only, so a reached profile is never itself expanded.
async function widenByAlignments(dataspaceId, requested, minCoverage) {
    const reach = new Map(requested.map((id) => [id, null]));
    for (const target of requested) {
        for (const alignment of await vocabhub.listAlignments(dataspaceId, { target, minCoverage })) {
            const source = alignment.source?.id;
            if (source && !reach.has(source)) {
                reach.set(source, {
                    alignmentId: alignment.id,
                    alignmentTitle: alignment.title,
                    sourceProfile: alignment.source,
                    targetProfile: alignment.target,
                    coverage: alignment.coverage,
                });
            }
        }
    }
    return reach;
}

// Only a path the catalog's profile defines can be filtered on, so a request cannot steer the query elsewhere.
function modelFieldFilters(model, requested) {
    const known = new Set();
    const walk = (fields, prefix) => fields.forEach((f) => {
        known.add([...prefix, f.path].join(' '));
        walk(f.fields, [...prefix, f.path]);
    });
    walk(model.fields, []);
    return (Array.isArray(requested) ? requested : [])
        .filter((f) => Array.isArray(f?.path) && known.has(f.path.join(' ')) && String(f.value ?? '').trim())
        .map((f) => ({ path: f.path, value: String(f.value).trim() }));
}

app.post('/api/semantic/search', async (req, res) => {
    const { searchText = '', consumerNodeId, providerNodeIds = null, fieldFilters = [], schemaProfiles = null, useAlignments = false, minCoverage = null, limit = 25 } = req.body || {};
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

    const requestedProfiles = Array.isArray(schemaProfiles) ? schemaProfiles.filter(Boolean) : [];
    let reach = new Map(requestedProfiles.map((id) => [id, null]));
    let alignmentsUsed = useAlignments && requestedProfiles.length > 0;
    let hubUnavailable = null;
    if (alignmentsUsed && !hubEnabled(dataspaceId)) {
        alignmentsUsed = false;
        hubUnavailable = NO_HUB;
    }
    if (alignmentsUsed) {
        try {
            reach = await widenByAlignments(dataspaceId, requestedProfiles, minCoverage);
        } catch (err) {
            // Losing the hub narrows discovery back to the picked profiles; it
            // is not a reason to fail a search the store can still answer.
            hubUnavailable = err.message;
            alignmentsUsed = false;
        }
    }

    try {
        const model = await catalogProfiles.catalogModel(dataspaceId, hubEnabled(dataspaceId));
        const rawResults = await semanticSearch({
            searchText,
            sessionCode: dataspaceId,
            datasetIds: visibleDatasetIds,
            textPaths: model.fields.map((f) => f.path),
            fieldFilters: modelFieldFilters(model, fieldFilters),
            schemaPath: model.dataStandard?.path || null,
            schemaProfiles: requestedProfiles.length > 0 ? [...reach.keys()] : null,
            limit: Math.min(Number(limit) || 25, 100),
        });

        const bpnToNodeId = new Map(
            db.getAllNodes()
                .filter((n) => n?.metadata?.bpn)
                .map((n) => [String(n.metadata.bpn).toLowerCase(), n.node_id])
        );

        // A result that declares a picked profile needs no explanation, even if
        // it also declares a reached one. Only the rest get labelled.
        const reachedVia = (result) => {
            const declared = model.dataStandard ? valuesAt(result.record, model.dataStandard.path) : [];
            if (declared.some((s) => reach.has(s) && reach.get(s) === null)) return null;
            return declared.map((s) => reach.get(s)).find(Boolean) || null;
        };

        const results = rawResults.map((result) => {
            const via = reachedVia(result);
            return {
                ...result,
                publisherNodeId: bpnToNodeId.get(String(result.publisherBpn || '').toLowerCase()) || result.publisherBpn,
                ...(via ? { reachableVia: via } : {}),
            };
        });
        res.json({ success: true, results, mode: 'catalog-first-fuseki', alignmentsUsed, ...(hubUnavailable ? { hubUnavailable } : {}) });
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

function resolveDataspaceId(raw) {
    const id = String(raw || '').trim();
    return id || 'demo';
}

function policyLabel(policyId) {
    return db.getPolicy(policyId)?.name || policyId || '';
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
        ownerName: db.getNode(a.owner_node_id)?.name || a.owner_node_id,
        fileName: a.file_name,
        policyId: a.policy_id,
        policyName: policyLabel(a.policy_id),
        dcatFields: a.dcat_fields,
        record: recordOf(a),
        publishedAt: a.published_at,
    };
}

// A dataspace's metadata language is the one its free-text fields are written in.
function recordOf(a) {
    const language = db.getDataspaceSettings(String(a.dataspace_id || 'demo')).metadata?.language || null;
    return assetToRecord({ title: a.name, description: a.description, dcatFields: a.dcat_fields || {}, language });
}

// ============================================================
// Start
// ============================================================

server.listen(PORT, () => {
    seedPolicies();
    if (db.isNewDatabase) seedDemoDataspace();
    const registered = registerUnlistedDataspaces();
    if (registered.length > 0) console.log(`[Seed] Listed ${registered.length} dataspace(s) found in the data: ${registered.join(', ')}`);
    reindexAllAssetsToSemantic().catch((err) => {
        console.error(`[Seed] SEARCH WILL BE INCOMPLETE: ${err.message}`);
    });
    vocabhub.refreshScenarioHubs()
        .then((loaded) => {
            for (const { dataspaceId, scenarioId, tripleCount, profileFields } of loaded) {
                console.log(`[Hub] ${dataspaceId}: ${tripleCount} triple(s), ${profileFields} catalog field(s) from scenario ${scenarioId}.`);
            }
        })
        .catch((err) => {
            console.error(`[Hub] VOCABULARY HUBS NOT REFRESHED: ${err.message}`);
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
