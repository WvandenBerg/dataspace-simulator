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

// Two-space output matches how the demo content was written when it lived in
// server.js, so moving it here left the stored asset bytes untouched.
function toAssetRow(asset, { dataspaceId, ownerNodeId, publishedAt }) {
    return {
        asset_id: asset.assetId,
        owner_node_id: ownerNodeId || asset.ownerId,
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

module.exports = {
    DEFAULT_SCENARIO_ID,
    listScenarios,
    getScenario,
    participantName,
    toAssetRow,
};
