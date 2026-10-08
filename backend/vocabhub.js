/**
 * vocabhub.js — the Vocabulary Hub: a registry of semantic profiles and the
 * directed alignments between them.
 *
 * Nothing here models what a profile is. The contents are Turtle files in the
 * shape Semantic Treehouse's catalogue export emits, loaded into named graphs
 * and read back with SPARQL, so the simulator consumes what STH produces
 * rather than an RDF model invented for the demo.
 *
 * Each dataspace runs its own hub. A scenario's catalogue export goes into a
 * graph of its own, so later additions to the same hub survive a scenario
 * being loaded again.
 */

const fs = require('fs');
const db = require('./db');
const scenarios = require('./scenarios');
const catalogProfiles = require('./catalogprofiles');
const { executeSelect, executeUpdate, replaceGraph, escapeIri } = require('./semantic');

const LEGACY_SHARED_GRAPH = 'urn:graph:vocabhub';
const ROLE_NS = 'http://www.w3.org/ns/dx/prof/role/';

const PREFIXES = `
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX dqv: <http://www.w3.org/ns/dqv#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX pmap: <https://w3id.org/pmap#>
PREFIX prof: <http://www.w3.org/ns/dx/prof/>
PREFIX role: <http://www.w3.org/ns/dx/prof/role/>
PREFIX vhx: <urn:vocabhub:ext:>
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const val = (row, key) => row[key]?.value;

function scenarioGraph(dataspaceId) {
    return `urn:graph:vocabhub:${encodeURIComponent(dataspaceId)}:scenario`;
}

function hubGraphs(dataspaceId) {
    return [scenarioGraph(dataspaceId), catalogProfiles.uploadsGraph(dataspaceId)];
}

// FROM merges the hub's graphs into one default graph, so a pattern may span them.
function hubQuery(dataspaceId, body) {
    const from = hubGraphs(dataspaceId).map((g) => `FROM <${g}>`).join('\n');
    return `${PREFIXES}\nSELECT ${body.select}\n${from}\nWHERE {\n${body.where}\n}${body.tail || ''}`;
}

async function withRetry(task, { maxAttempts = 20, retryDelayMs = 1500 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await task();
        } catch (err) {
            lastError = err;
            await sleep(retryDelayMs);
        }
    }
    throw new Error(`gave up after ${maxAttempts} attempts: ${lastError?.message}`);
}

async function loadScenarioIntoHub(dataspaceId, scenario) {
    const file = scenarios.catalogExportFile(scenario);
    const tripleCount = file
        ? await replaceGraph(scenarioGraph(dataspaceId), fs.readFileSync(file, 'utf8'))
        : 0;
    const profiles = await catalogProfiles.installScenarioProfiles(dataspaceId, scenario);
    // Only a dataspace that never chose gets the scenario's first profile; null is a choice too.
    if (profiles.length > 0 && db.getDataspaceSettings(dataspaceId).catalog?.profileId === undefined) {
        db.patchDataspaceSettings(dataspaceId, { catalog: { profileId: profiles[0].profileId } });
    }
    return { tripleCount, profileFields: profiles[0]?.fields ?? 0 };
}

// Startup refresh, so an edited fixture takes effect on restart.
async function refreshScenarioHubs() {
    const loaded = [];

    await withRetry(() => executeUpdate(`DROP SILENT GRAPH <${LEGACY_SHARED_GRAPH}>`));
    for (const { dataspace_id: dataspaceId, scenario_id: scenarioId } of db.getAllDataspaces()) {
        const scenario = scenarioId ? scenarios.getScenario(scenarioId) : null;
        if (!scenario || (!scenarios.catalogExportFile(scenario) && !scenario.catalogProfiles)) continue;
        const { tripleCount, profileFields } = await withRetry(() => loadScenarioIntoHub(dataspaceId, scenario));
        loaded.push({ dataspaceId, scenarioId, tripleCount, profileFields });
    }
    return loaded;
}

// An alignment is also typed prof:Profile in the export, so every profile query
// has to say it does not want them.
const NOT_AN_ALIGNMENT = 'FILTER NOT EXISTS { ?profile a pmap:ProfileAlignment }';

function toProfile(row) {
    return {
        id: val(row, 'profile'),
        title: val(row, 'title') || val(row, 'profile'),
        description: val(row, 'description') || '',
        version: val(row, 'version') || '',
        publisher: val(row, 'publisher') || '',
    };
}

async function listProfiles(dataspaceId) {
    const rows = await executeSelect(hubQuery(dataspaceId, {
        select: '?profile ?title ?description ?version ?publisher',
        where: `    ?profile a prof:Profile .
    ${NOT_AN_ALIGNMENT}
    OPTIONAL { ?profile dcterms:title ?title }
    OPTIONAL { ?profile dcterms:description ?description }
    OPTIONAL { ?profile owl:versionInfo ?version }
    OPTIONAL { ?profile dcterms:publisher/foaf:name ?publisher }`,
        tail: '\nORDER BY ?title',
    }));
    return rows.map(toProfile);
}

function toResource(row) {
    const roleIri = val(row, 'role') || '';
    return {
        role: roleIri.startsWith(ROLE_NS) ? roleIri.slice(ROLE_NS.length) : roleIri,
        roleIri,
        artifact: val(row, 'artifact') || '',
        format: val(row, 'format') || '',
        conformsTo: val(row, 'conformsTo') || '',
    };
}

async function resourcesFor(dataspaceId, profileId, roleFilter = '') {
    const rows = await executeSelect(hubQuery(dataspaceId, {
        select: '?role ?artifact ?format ?conformsTo',
        where: `    <${escapeIri(profileId)}> prof:hasResource ?resource .
    ?resource prof:hasRole ?role ; prof:hasArtifact ?artifact .
    ${roleFilter}
    OPTIONAL { ?resource dcterms:format ?format }
    OPTIONAL { ?resource dcterms:conformsTo ?conformsTo }`,
    }));
    return rows.map(toResource);
}

async function getProfile(dataspaceId, profileId) {
    const rows = await executeSelect(hubQuery(dataspaceId, {
        select: '?profile ?title ?description ?version ?publisher',
        where: `    VALUES ?profile { <${escapeIri(profileId)}> }
    ?profile a prof:Profile .
    ${NOT_AN_ALIGNMENT}
    OPTIONAL { ?profile dcterms:title ?title }
    OPTIONAL { ?profile dcterms:description ?description }
    OPTIONAL { ?profile owl:versionInfo ?version }
    OPTIONAL { ?profile dcterms:publisher/foaf:name ?publisher }`,
    }));
    if (rows.length === 0) return null;
    return { ...toProfile(rows[0]), resources: await resourcesFor(dataspaceId, profileId) };
}

async function shapesFor(dataspaceId, profileId) {
    return resourcesFor(dataspaceId, profileId, '?resource prof:hasRole role:validation .');
}

// Directed and single hop, per US-6. Asking what reaches OpenLABEL must not
// walk on through whatever reaches the things that reach it; coverage does not
// compose, so a two-hop answer would carry a number nobody could justify.
async function listAlignments(dataspaceId, { target, minCoverage } = {}) {
    const filters = [];
    if (target) filters.push(`VALUES ?target { <${escapeIri(target)}> }`);
    if (minCoverage !== undefined && minCoverage !== '' && Number.isFinite(Number(minCoverage))) {
        filters.push(`FILTER(?coverage >= ${Number(minCoverage)})`);
    }

    const rows = await executeSelect(hubQuery(dataspaceId, {
        select: '?alignment ?title ?description ?source ?sourceTitle ?target ?targetTitle ?coverage',
        where: `    ?alignment a pmap:ProfileAlignment ;
      pmap:sourceProfile ?source ;
      pmap:targetProfile ?target .
    ${filters.join('\n    ')}
    OPTIONAL { ?alignment dcterms:title ?title }
    OPTIONAL { ?alignment dcterms:description ?description }
    OPTIONAL { ?source dcterms:title ?sourceTitle }
    OPTIONAL { ?target dcterms:title ?targetTitle }
    OPTIONAL {
      ?alignment dqv:hasQualityMeasurement [ dqv:isMeasurementOf vhx:profileCoverage ; dqv:value ?coverage ]
    }`,
        tail: '\nORDER BY DESC(?coverage)',
    }));

    return rows.map((row) => ({
        id: val(row, 'alignment'),
        title: val(row, 'title') || val(row, 'alignment'),
        description: val(row, 'description') || '',
        source: { id: val(row, 'source'), title: val(row, 'sourceTitle') || val(row, 'source') },
        target: { id: val(row, 'target'), title: val(row, 'targetTitle') || val(row, 'target') },
        coverage: val(row, 'coverage') === undefined ? null : Number(val(row, 'coverage')),
    }));
}

// Holding shapes is what makes a profile usable as a catalog profile, whatever
// kind of standard it otherwise is.
async function listCatalogProfiles(dataspaceId) {
    const described = new Map((await listProfiles(dataspaceId)).map((p) => [p.id, p]));
    return catalogProfiles.listFileProfiles(dataspaceId)
        .filter((p) => p.files.some((f) => f.role === 'validation'))
        .map((p) => ({ ...(described.get(p.id) || toProfile({})), id: p.id, source: p.source, files: p.files }));
}

// What the hub says each of these resources is, such as a profile being a dcterms:Standard.
async function typesOf(dataspaceId, iris) {
    if (iris.length === 0) return [];
    const rows = await executeSelect(hubQuery(dataspaceId, {
        select: 'DISTINCT ?s ?type',
        where: `VALUES ?s { ${iris.map((i) => `<${escapeIri(i)}>`).join(' ')} } ?s a ?type .`,
    }));
    return rows.map((r) => [val(r, 's'), val(r, 'type')]);
}

module.exports = {
    loadScenarioIntoHub,
    refreshScenarioHubs,
    listProfiles,
    listCatalogProfiles,
    typesOf,
    getProfile,
    shapesFor,
    listAlignments,
};
