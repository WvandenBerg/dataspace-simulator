/**
 * semantic.js — Apache Fuseki SPARQL integration for the Dataspace Simulator
 *
 * Provides typed helpers for reading and writing DCAT/RDF metadata.
 * This module is designed to be directly portable to the real EDC participant app.
 *
 * RDF model:
 *   Each asset => dcat:Dataset
 *   Each publisher => foaf:Agent linked via dct:publisher
 *   Multi-valued fields (keywords, themes, spatial) => separate triples per value
 *   Policy reference stored as odrl:policy literal
 *   Session scoping via dct:isPartOf
 */

const axios = require('axios');
const { RDF_TYPE, P, curie } = require('./record');

const FUSEKI_URL = process.env.FUSEKI_URL || 'http://sim-fuseki:3030';
const FUSEKI_DATASET = process.env.FUSEKI_DATASET || 'simulator';
const FUSEKI_USERNAME = process.env.FUSEKI_USERNAME || '';
const FUSEKI_PASSWORD = process.env.FUSEKI_PASSWORD || '';
const UPDATE_ENDPOINT = `${FUSEKI_URL}/${FUSEKI_DATASET}/update`;
const QUERY_ENDPOINT = `${FUSEKI_URL}/${FUSEKI_DATASET}/sparql`;
const GRAPH_STORE_ENDPOINT = `${FUSEKI_URL}/${FUSEKI_DATASET}/data`;

function withAuth(config = {}) {
    if (!FUSEKI_USERNAME && !FUSEKI_PASSWORD) {
        return config;
    }
    return {
        ...config,
        auth: {
            username: FUSEKI_USERNAME,
            password: FUSEKI_PASSWORD,
        },
    };
}

// ---------------------------------------------------------------------------
// Low-level SPARQL helpers
// ---------------------------------------------------------------------------

async function executeUpdate(updateQuery) {
    await axios.post(UPDATE_ENDPOINT, `update=${encodeURIComponent(updateQuery)}`, withAuth({
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }));
}

async function executeSelect(selectQuery) {
    const response = await axios.get(QUERY_ENDPOINT, withAuth({
        params: { query: selectQuery },
        headers: { Accept: 'application/sparql-results+json' }
    }));
    return response.data?.results?.bindings || [];
}

// Replaces a whole named graph in one request, so a graph built from files can
// be rebuilt from those files rather than reconciled triple by triple.
async function replaceGraph(graphIri, body, contentType = 'text/turtle') {
    const response = await axios.put(GRAPH_STORE_ENDPOINT, body, withAuth({
        params: { graph: graphIri },
        headers: { 'Content-Type': contentType }
    }));
    return response.data?.tripleCount ?? 0;
}

async function dropGraph(graphIri) {
    await executeUpdate(`DROP SILENT GRAPH <${graphIri}>`);
}

// ---------------------------------------------------------------------------
// IRI helpers
// ---------------------------------------------------------------------------

function datasetIri(datasetId) {
    return `urn:dataset:${encodeURIComponent(datasetId)}`;
}

function participantIri(bpn) {
    return `urn:participant:${encodeURIComponent(bpn)}`;
}

function graphIriForDataset(dataset) {
    const publisher = encodeURIComponent(dataset.publisherBpn || 'unknown');
    const session = encodeURIComponent(dataset.sessionCode || 'local');
    return `urn:graph:participant:${publisher}:session:${session}`;
}

function escapeLiteral(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// A caller-supplied IRI goes inside <>, where an unescaped '>' would close the
// term and let the rest of the value be read as SPARQL.
function escapeIri(value) {
    return encodeURI(String(value || '').trim()).replace(/[<>"{}|\\^`]/g, '');
}

// ---------------------------------------------------------------------------
// Record to triples
//
// A nested node is minted under its dataset's IRI, so everything a dataset
// owns can be found and replaced without knowing which properties lead there.
// ---------------------------------------------------------------------------

function literalTerm(v) {
    const text = `"${escapeLiteral(v.value)}"`;
    if (v.lang) return `${text}@${v.lang}`;
    if (v.datatype) return `${text}^^<${escapeIri(v.datatype)}>`;
    return text;
}

function recordTriples(subjectIri, record, mint) {
    const triples = [];
    for (const [path, values] of Object.entries(record || {})) {
        const predicate = `<${escapeIri(path)}>`;
        for (const v of values) {
            if (v.fields) {
                const node = mint();
                triples.push(`<${subjectIri}> ${predicate} <${node}> .`);
                if (v.type) triples.push(`<${node}> <${RDF_TYPE}> <${escapeIri(v.type)}> .`);
                triples.push(...recordTriples(node, v.fields, mint));
            } else if (v.iri) {
                triples.push(`<${subjectIri}> ${predicate} <${escapeIri(v.iri)}> .`);
            } else {
                triples.push(`<${subjectIri}> ${predicate} ${literalTerm(v)} .`);
            }
        }
    }
    return triples;
}

// Removes a dataset's own nodes; datasetPattern must bind ?ds. Nodes used to be
// minted as urn:distribution:<id>:<n> and urn:datastandard:<id>:<n>, which a
// store from before this change still holds until each dataset is re-indexed.
function ownedNodesDelete(datasetPattern) {
    return `DELETE { GRAPH ?g { ?n ?p ?o } }
WHERE {
    GRAPH ?g {
        ${datasetPattern}
        ?n ?p ?o .
        BIND(STRAFTER(STR(?ds), "urn:dataset:") AS ?id)
        FILTER(STRSTARTS(STR(?n), CONCAT(STR(?ds), "#"))
            || STRSTARTS(STR(?n), CONCAT("urn:distribution:", ?id, ":"))
            || STRSTARTS(STR(?n), CONCAT("urn:datastandard:", ?id, ":")))
    }
}`;
}

// ---------------------------------------------------------------------------
// Upsert a dataset (delete all existing triples for this IRI, then insert fresh)
// dataset: { datasetId, record, policyName, publisherBpn, publisherName, sessionCode, publishedAt }
// ---------------------------------------------------------------------------

async function upsertSemanticDataset(dataset) {
    const dsIri = datasetIri(dataset.datasetId);
    const pubIri = participantIri(dataset.publisherBpn);
    const graphIri = graphIriForDataset(dataset);
    let nodes = 0;
    const mint = () => `${dsIri}#n${nodes++}`;

    const triples = [
        `<${dsIri}> a <http://www.w3.org/ns/dcat#Dataset> .`,
        `<${dsIri}> <http://purl.org/dc/terms/identifier> "${escapeLiteral(dataset.datasetId)}" .`,
        `<${dsIri}> <http://purl.org/dc/terms/publisher> <${pubIri}> .`,
        `<${dsIri}> <http://purl.org/dc/terms/issued> "${escapeLiteral(dataset.publishedAt)}" .`,
        `<${pubIri}> <http://purl.org/dc/terms/identifier> "${escapeLiteral(dataset.publisherBpn)}" .`,
        `<${pubIri}> <http://xmlns.com/foaf/0.1/name> "${escapeLiteral(dataset.publisherName || dataset.publisherBpn)}" .`,
        ...recordTriples(dsIri, dataset.record, mint),
    ];

    if (dataset.policyName) {
        triples.push(`<${dsIri}> <http://www.w3.org/ns/odrl/2/policy> "${escapeLiteral(dataset.policyName)}" .`);
    }
    if (dataset.sessionCode) {
        triples.push(`<${dsIri}> <http://purl.org/dc/terms/isPartOf> "${escapeLiteral(dataset.sessionCode)}" .`);
    }

    const updateQuery = `
${ownedNodesDelete(`VALUES ?ds { <${dsIri}> }`)} ;

DELETE { GRAPH ?g { <${dsIri}> ?p ?o } }
WHERE  { GRAPH ?g { <${dsIri}> ?p ?o } } ;

INSERT DATA {
    GRAPH <${graphIri}> {
    ${triples.join('\n    ')}
    }
}`;

    await executeUpdate(updateQuery);
}

// ---------------------------------------------------------------------------
// Delete a single dataset by ID
// ---------------------------------------------------------------------------

async function deleteSemanticDataset(datasetId) {
    const dsIri = datasetIri(datasetId);
    const q = `${ownedNodesDelete(`VALUES ?ds { <${dsIri}> }`)} ;

DELETE { GRAPH ?g { <${dsIri}> ?p ?o } } WHERE { GRAPH ?g { <${dsIri}> ?p ?o } }`;
    await executeUpdate(q);
}

// ---------------------------------------------------------------------------
// Delete all datasets for a publisher BPN
// ---------------------------------------------------------------------------

async function deleteSemanticDatasetsForParticipant(publisherBpn) {
    const pubIri = participantIri(publisherBpn);
    const q = `
${ownedNodesDelete(`?ds <http://purl.org/dc/terms/publisher> <${pubIri}> .`)} ;

DELETE { GRAPH ?g { ?ds ?p ?o } }
WHERE {
    GRAPH ?g {
        ?ds <http://purl.org/dc/terms/publisher> <${pubIri}> .
        ?ds ?p ?o .
    }
}`;
    await executeUpdate(q);
}

// ---------------------------------------------------------------------------
// Triples back to records
// ---------------------------------------------------------------------------

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

function termToValue(term) {
    if (term.type === 'uri') return { iri: term.value };
    return {
        value: term.value,
        ...(term['xml:lang'] ? { lang: term['xml:lang'] } : {}),
        ...(term.datatype && term.datatype !== XSD_STRING ? { datatype: term.datatype } : {}),
    };
}

// The record of every dataset in a dataspace, keyed by dataset id. It holds the
// dataset's triples, those of the nodes minted under its IRI, and those of nodes
// it links to directly, such as the publisher several datasets share.
async function readRecords(sessionCode, datasetIds = null) {
    const only = datasetIds ? `FILTER(STR(?id) IN (${datasetIds.map((id) => `"${escapeLiteral(id)}"`).join(', ')}))` : '';
    const rows = await executeSelect(`
SELECT DISTINCT ?id ?ds ?s ?p ?o
WHERE {
    GRAPH ?g {
        ?ds a <http://www.w3.org/ns/dcat#Dataset> ;
            <http://purl.org/dc/terms/identifier> ?id ;
            <http://purl.org/dc/terms/isPartOf> "${escapeLiteral(sessionCode)}" .
        ${only}
        ?s ?p ?o .
        FILTER(?s = ?ds || STRSTARTS(STR(?s), CONCAT(STR(?ds), "#")) || EXISTS { ?ds ?link ?s })
    }
}`);

    const subjects = new Map();
    const roots = new Map();
    const seenTriples = new Set();
    for (const row of rows) {
        const s = row.s.value;
        roots.set(row.id.value, row.ds.value);
        const key = `${s} ${row.p.value} ${row.o.type} ${row.o.value}`;
        if (seenTriples.has(key)) continue;
        seenTriples.add(key);
        if (!subjects.has(s)) subjects.set(s, { type: null, fields: {} });
        const subject = subjects.get(s);
        if (row.p.value === RDF_TYPE) subject.type = row.o.value;
        else (subject.fields[row.p.value] ||= []).push(termToValue(row.o));
    }

    const build = (s, seen) => {
        const fields = {};
        for (const [path, values] of Object.entries(subjects.get(s)?.fields || {})) {
            fields[path] = values.map((v) => {
                const node = v.iri && subjects.get(v.iri);
                if (!node || seen.has(v.iri)) return v;
                return {
                    // A node minted for this dataset has no identity outside it; a shared one keeps its IRI.
                    ...(v.iri.startsWith(`${s.split('#')[0]}#`) ? {} : { iri: v.iri }),
                    ...(node.type ? { type: node.type } : {}),
                    fields: build(v.iri, new Set([...seen, v.iri])),
                };
            });
        }
        return fields;
    };

    return new Map([...roots].map(([id, ds]) => [id, build(ds, new Set([ds]))]));
}

// ---------------------------------------------------------------------------
// Search
//
// Which fields exist comes from the catalog's profile: callers pass paths, each
// a list of property IRIs from the dataset down. The query only decides which
// datasets match; what they hold is read back as records afterwards.
// ---------------------------------------------------------------------------

const ABSOLUTE_IRI = /^[a-z][a-z0-9+.-]*:\S+$/i;

const pathExpr = (path) => path.map((p) => `<${escapeIri(p)}>`).join('/');

// A code-list value is an IRI and matches whole; anything else matches as text.
function valueFilter(variable, value) {
    return ABSOLUTE_IRI.test(value)
        ? `STR(${variable}) = "${escapeLiteral(value)}"`
        : `CONTAINS(LCASE(STR(${variable})), LCASE("${escapeLiteral(value)}"))`;
}

const strings = (values = []) => values.filter((v) => !v.fields).map((v) => v.value ?? v.iri);
const first = (values) => strings(values)[0] || '';

function distributionFromNode({ fields }) {
    const standard = (fields[P.mobilityDataStandard] || []).find((v) => v.fields)?.fields;
    return {
        title: first(fields[P.title]),
        accessUrl: first(fields[P.accessURL]),
        mediaType: first(fields[P.mediaType]),
        format: first(fields[P.format]),
        dataStandard: standard ? {
            label: first(standard[P.title]),
            conformsTo: first(standard[P.conformsTo]),
            version: first(standard[P.versionInfo]),
            schema: strings(standard[P.schema]),
        } : null,
    };
}

// The shape results had before records, kept until the views read records themselves.
function resultFromRecord(datasetId, record) {
    const publisher = (record[P.publisher] || []).find((v) => v.fields)?.fields || {};
    const dcat = {};
    for (const [path, values] of Object.entries(record)) {
        if (strings(values).length > 0) dcat[curie(path)] = strings(values);
    }
    return {
        datasetId,
        title: first(record[P.title]),
        description: first(record[P.description]),
        publisherBpn: first(publisher[P.identifier]),
        publisherName: first(publisher[P.name]),
        policyName: first(record[P.policy]),
        publishedAt: first(record[P.issued]),
        sessionCode: first(record[P.isPartOf]),
        spatial: strings(record[P.spatial]),
        temporalCoverage: first(record[P.temporal]),
        keywords: strings(record[P.keyword]),
        themes: strings(record[P.theme]),
        dcat,
        distributions: (record[P.distribution] || []).filter((v) => v.fields).map(distributionFromNode),
        record,
    };
}

async function semanticSearch({
    searchText = '',
    sessionCode,
    datasetIds = null,
    textPaths = [],
    fieldFilters = [],
    schemaPath = null,
    schemaProfiles = null,
    limit = 25
}) {
    const patterns = [];

    if (datasetIds && datasetIds.length > 0) {
        patterns.push(`FILTER(STR(?datasetId) IN (${datasetIds.map((id) => `"${escapeLiteral(id)}"`).join(', ')}))`);
    }
    // Free text looks at literals only, so a theme stored as a label still matches where the profile expects an IRI.
    if (searchText) {
        const onPaths = textPaths.length > 0 ? `VALUES ?textPath { ${textPaths.map((p) => `<${escapeIri(p)}>`).join(' ')} }` : '';
        patterns.push(`FILTER EXISTS {
            ${onPaths}
            ?dataset ?textPath ?text .
            FILTER(isLiteral(?text) && CONTAINS(LCASE(STR(?text)), LCASE("${escapeLiteral(searchText)}")))
        }`);
    }
    fieldFilters.forEach(({ path, value }, i) => {
        patterns.push(`?dataset ${pathExpr(path)} ?f${i} .`, `FILTER(${valueFilter(`?f${i}`, value)})`);
    });

    // Set membership rather than substring: a profile IRI either is or is not
    // the one asked for. Compared as strings, because a legacy entry may hold it as a literal.
    const schemaSet = Array.isArray(schemaProfiles)
        ? [...new Set(schemaProfiles.map((p) => escapeIri(p)).filter(Boolean))]
        : [];
    if (schemaSet.length > 0) {
        patterns.push(schemaPath
            ? `?dataset ${pathExpr(schemaPath)} ?schemaMatch . FILTER(STR(?schemaMatch) IN (${schemaSet.map((p) => `"${escapeLiteral(p)}"`).join(', ')}))`
            : 'FILTER(false)');
    }

    const query = `
SELECT DISTINCT ?datasetId ?publishedAt
WHERE {
    GRAPH ?g {
        ?dataset a <http://www.w3.org/ns/dcat#Dataset> ;
            <${P.identifier}> ?datasetId ;
            <${P.issued}> ?publishedAt ;
            <${P.isPartOf}> "${escapeLiteral(sessionCode)}" .
        ${patterns.join('\n        ')}
    }
}
ORDER BY DESC(?publishedAt)
LIMIT ${Math.max(1, Math.min(Number(limit) || 25, 200))}`;

    const ids = (await executeSelect(query)).map((row) => row.datasetId.value);
    if (ids.length === 0) return [];
    const records = await readRecords(sessionCode, ids);
    return ids.filter((id) => records.has(id)).map((id) => resultFromRecord(id, records.get(id)));
}

module.exports = {
    upsertSemanticDataset,
    deleteSemanticDataset,
    deleteSemanticDatasetsForParticipant,
    semanticSearch,
    readRecords,
    executeSelect,
    executeUpdate,
    replaceGraph,
    dropGraph,
    escapeIri,
    escapeLiteral,
};
