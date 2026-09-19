/**
 * scenarios.js — data-driven demo presets.
 *
 * A scenario owns both halves of a demo: the participants on the ring and the
 * assets they publish. Keeping the two in one file is what stops a dataspace
 * ending up with participants that have nothing to serve.
 */

const fs = require('fs');
const path = require('path');

const SCENARIO_DIR = path.join(__dirname, 'scenarios');
const DEFAULT_SCENARIO_ID = 'construction-demo';
const RING_RADIUS = 610;

// Same convention the frontend uses (see useDragNodes.js), so loading a scenario
// twice into different dataspaces cannot collide on a primary key.
function scopedId(dataspaceId, baseId) {
    return dataspaceId === 'demo' ? baseId : `${dataspaceId}::${baseId}`;
}

function validationProblems(scenario) {
    const problems = [];
    if (typeof scenario.id !== 'string' || !scenario.id) problems.push('missing "id"');
    if (typeof scenario.name !== 'string' || !scenario.name) problems.push('missing "name"');
    if (!Array.isArray(scenario.participants)) problems.push('"participants" must be an array');
    if (!Array.isArray(scenario.assets)) problems.push('"assets" must be an array');
    if (problems.length > 0) return problems;

    const participantIds = new Set(scenario.participants.map((p) => p.id));
    for (const asset of scenario.assets) {
        if (!participantIds.has(asset.ownerId)) {
            problems.push(`asset "${asset.assetId}" names ownerId "${asset.ownerId}", which is not a participant`);
        }
    }

    if (scenario.catalogExport !== undefined) {
        const file = catalogExportFile(scenario);
        if (!file || !fs.existsSync(file)) {
            problems.push(`"catalogExport" does not resolve to a file inside ${SCENARIO_DIR}`);
        }
    }
    return problems;
}

// Indexing by id rather than resolving a path from one keeps a caller-supplied
// scenario id from reaching the filesystem.
function readScenarios() {
    const byId = new Map();
    const files = fs.readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.json')).sort();

    for (const file of files) {
        const scenario = JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, file), 'utf8'));
        const problems = validationProblems(scenario);
        if (problems.length > 0) {
            throw new Error(`Scenario ${file} is invalid: ${problems.join('; ')}`);
        }
        byId.set(scenario.id, scenario);
    }
    return byId;
}

const scenarios = readScenarios();

function listScenarios() {
    return [...scenarios.values()].map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description || '',
        participantCount: s.participants.length,
        assetCount: s.assets.length,
    }));
}

function getScenario(id) {
    return scenarios.get(id) || null;
}

function participantName(scenario, participantId) {
    return scenario.participants.find((p) => p.id === participantId)?.name || participantId;
}

// Declared per scenario, but every export ends up in one shared Vocabulary Hub
// graph: a hub that served a single dataspace would not be a hub.
function catalogExportFile(scenario) {
    if (!scenario.catalogExport) return null;
    const resolved = path.resolve(SCENARIO_DIR, scenario.catalogExport);
    return resolved.startsWith(SCENARIO_DIR + path.sep) ? resolved : null;
}

function catalogExportFiles() {
    return [...scenarios.values()].map(catalogExportFile).filter(Boolean);
}

// Two-space output matches how the demo content was written when it lived in
// server.js, so moving it here left the stored asset bytes untouched.
function toAssetRow(asset, { dataspaceId, publishedAt }) {
    return {
        asset_id: scopedId(dataspaceId, asset.assetId),
        owner_node_id: scopedId(dataspaceId, asset.ownerId),
        dataspace_id: dataspaceId,
        name: asset.name,
        description: asset.description || '',
        file_name: asset.fileName || '',
        asset_content: JSON.stringify(asset.content ?? {}, null, 2),
        policy_id: asset.policyId || 'sys-open',
        dcat_fields: asset.dcatFields || {},
        published_at: publishedAt,
    };
}

// Participants are spread evenly around the ring; the frontend lets the user
// drag them afterwards, so these are only starting positions.
function toNodeRow(participant, { dataspaceId, index, total }) {
    const angle = ((90 + (index * 360) / total) * Math.PI) / 180;
    return {
        node_id: scopedId(dataspaceId, participant.id),
        name: participant.name,
        x: Math.cos(angle) * RING_RADIUS,
        y: Math.sin(angle) * RING_RADIUS,
        metadata: {
            ...(participant.credentials || {}),
            bpn: participant.bpn || '',
            dataspaceId,
            location: participant.location || '',
            domain: participant.domain || '',
            roles: participant.roles || { provider: true, consumer: true },
            ontologies: participant.ontologies || [],
            dataCategories: participant.dataCategories || [],
            formats: participant.formats || [],
            tags: participant.tags || [],
        },
    };
}

module.exports = {
    DEFAULT_SCENARIO_ID,
    listScenarios,
    getScenario,
    participantName,
    catalogExportFiles,
    scopedId,
    toAssetRow,
    toNodeRow,
};
