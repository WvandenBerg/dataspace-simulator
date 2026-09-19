/**
 * vocabhub.js — the Vocabulary Hub: a registry of semantic profiles and the
 * directed alignments between them.
 *
 * Nothing here models what a profile is. The contents are Turtle files in the
 * shape Semantic Treehouse's catalogue export emits, loaded into one named
 * graph and read back with SPARQL, so the simulator consumes what STH produces
 * rather than an RDF model invented for the demo.
 *
 * One graph, shared by every dataspace, rebuilt from the scenario files at
 * startup. That makes an edited fixture take effect on restart and leaves no
 * stale triples behind.
 */

const fs = require('fs');
const scenarios = require('./scenarios');
const { executeSelect, replaceGraph, escapeIri } = require('./semantic');

const HUB_GRAPH = 'urn:graph:vocabhub';
const ROLE_NS = 'http://www.w3.org/ns/dx/prof/role/';
const EMPTY_GRAPH = '# No scenario declares a catalogue export.\n';

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

function hubQuery(body) {
    return `${PREFIXES}\nSELECT ${body.select} WHERE {\n  GRAPH <${HUB_GRAPH}> {\n${body.where}\n  }\n}${body.tail || ''}`;
}

async function rebuildHub({ maxAttempts = 20, retryDelayMs = 1500 } = {}) {
    const files = scenarios.catalogExportFiles();
    const turtle = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n\n') || EMPTY_GRAPH;

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const tripleCount = await replaceGraph(HUB_GRAPH, turtle);
            return { files: files.length, tripleCount };
        } catch (err) {
            lastError = err;
            await sleep(retryDelayMs);
        }
    }
    throw new Error(`could not load the hub graph after ${maxAttempts} attempts: ${lastError?.message}`);
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

async function listProfiles() {
    const rows = await executeSelect(hubQuery({
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

async function resourcesFor(profileId, roleFilter = '') {
    const rows = await executeSelect(hubQuery({
        select: '?role ?artifact ?format ?conformsTo',
        where: `    <${escapeIri(profileId)}> prof:hasResource ?resource .
    ?resource prof:hasRole ?role ; prof:hasArtifact ?artifact .
    ${roleFilter}
    OPTIONAL { ?resource dcterms:format ?format }
    OPTIONAL { ?resource dcterms:conformsTo ?conformsTo }`,
    }));
    return rows.map(toResource);
}

async function getProfile(profileId) {
    const rows = await executeSelect(hubQuery({
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
    return { ...toProfile(rows[0]), resources: await resourcesFor(profileId) };
}

async function shapesFor(profileId) {
    return resourcesFor(profileId, '?resource prof:hasRole role:validation .');
}

// Directed and single hop, per US-6. Asking what reaches OpenLABEL must not
// walk on through whatever reaches the things that reach it; coverage does not
// compose, so a two-hop answer would carry a number nobody could justify.
async function listAlignments({ target, minCoverage } = {}) {
    const filters = [];
    if (target) filters.push(`VALUES ?target { <${escapeIri(target)}> }`);
    if (minCoverage !== undefined && minCoverage !== '' && Number.isFinite(Number(minCoverage))) {
        filters.push(`FILTER(?coverage >= ${Number(minCoverage)})`);
    }

    const rows = await executeSelect(hubQuery({
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

module.exports = {
    HUB_GRAPH,
    rebuildHub,
    listProfiles,
    getProfile,
    shapesFor,
    listAlignments,
};
