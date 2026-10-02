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
const { RDF_TYPE, P } = require('./record');

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
// DCAT field → RDF predicate mapping
// Portable: same mapping used in real participant backend
// ---------------------------------------------------------------------------

const DCAT_FIELD_TO_PREDICATE = {
    'dct:title': 'http://purl.org/dc/terms/title',
    'dct:description': 'http://purl.org/dc/terms/description',
    'dcat:keyword': 'http://www.w3.org/ns/dcat#keyword',
    'dcat:theme': 'http://www.w3.org/ns/dcat#theme',
    'dct:spatial': 'http://purl.org/dc/terms/spatial',
    'dct:temporal': 'http://purl.org/dc/terms/temporal',
    'dct:language': 'http://purl.org/dc/terms/language',
    'dct:license': 'http://purl.org/dc/terms/license',
    'dct:format': 'http://purl.org/dc/terms/format',
    'dct:creator': 'http://purl.org/dc/terms/creator',
    'dct:conformsTo': 'http://purl.org/dc/terms/conformsTo',
    'dct:accrualPeriodicity': 'http://purl.org/dc/terms/accrualPeriodicity',
    'dct:relation': 'http://purl.org/dc/terms/relation',
    'dcat:landingPage': 'http://www.w3.org/ns/dcat#landingPage',
    'dcat:contactPoint': 'http://www.w3.org/ns/dcat#contactPoint',
    'mobilitydcatap:mobilityTheme': 'https://w3id.org/mobilitydcat-ap#mobilityTheme',
    'mobilitydcatap:transportMode': 'https://w3id.org/mobilitydcat-ap#transportMode',
    'mobilitydcatap:networkCoverage': 'https://w3id.org/mobilitydcat-ap#networkCoverage',
    'mobilitydcatap:georeferencingMethod': 'https://w3id.org/mobilitydcat-ap#georeferencingMethod',
    'mobilitydcatap:intendedInformationService': 'https://w3id.org/mobilitydcat-ap#intendedInformationService',
};

// Multi-valued results are joined with an ASCII unit separator, not a comma:
// titles, descriptions and spatial labels routinely contain commas themselves.
const MULTI_VALUE_SEPARATOR = '\u001F';

// Fields the search query already binds by name, so that filters written
// against those variables keep working. Every other field gets a generated
// variable and an OPTIONAL clause.
const DCAT_QUERY_VARS = {
    'dct:title': 'title',
    'dct:description': 'description',
    'dcat:keyword': 'keyword',
    'dcat:theme': 'theme',
    'dct:spatial': 'spatialValue',
    'dct:temporal': 'temporalValue',
};

function sparqlSafeName(key) {
    return key.replace(/[^A-Za-z0-9]/g, '_');
}

function dcatQueryVar(key) {
    return DCAT_QUERY_VARS[key] || `dcatValue_${sparqlSafeName(key)}`;
}

function dcatResultVar(key) {
    return `dcat_${sparqlSafeName(key)}`;
}

function splitMultiValue(value) {
    return String(value || '')
        .split(MULTI_VALUE_SEPARATOR)
        .map(part => part.trim())
        .filter(Boolean);
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
// Distributions for a set of datasets.
//
// Deliberately a second query. Folding these into the search SELECT would mean
// GROUP_CONCAT over a cross-product, which loses which standard belongs to
// which distribution the moment a dataset has more than one.
// ---------------------------------------------------------------------------

async function distributionsForDatasets(datasetIds) {
    if (!datasetIds || datasetIds.length === 0) return new Map();

    const idList = datasetIds.map(id => `"${escapeLiteral(id)}"`).join(', ');
    const query = `
SELECT ?datasetId ?dist ?distTitle ?accessURL ?mediaType ?format ?stdLabel ?stdConformsTo ?stdVersion ?schema
WHERE {
    GRAPH ?g {
        ?dataset <http://purl.org/dc/terms/identifier> ?datasetId ;
            <${P.distribution}> ?dist .
        FILTER(STR(?datasetId) IN (${idList}))
        OPTIONAL { ?dist <${P.title}> ?distTitle . }
        OPTIONAL { ?dist <${P.accessURL}> ?accessURL . }
        OPTIONAL { ?dist <${P.mediaType}> ?mediaType . }
        OPTIONAL { ?dist <${P.format}> ?format . }
        OPTIONAL {
            ?dist <${P.mobilityDataStandard}> ?std .
            OPTIONAL { ?std <${P.title}> ?stdLabel . }
            OPTIONAL { ?std <${P.conformsTo}> ?stdConformsTo . }
            OPTIONAL { ?std <${P.versionInfo}> ?stdVersion . }
            OPTIONAL { ?std <${P.schema}> ?schema . }
        }
    }
}
ORDER BY ?datasetId ?dist`;

    const byDataset = new Map();
    const byIri = new Map();

    for (const row of await executeSelect(query)) {
        const datasetId = row.datasetId?.value || '';
        const iri = row.dist?.value || '';
        if (!iri) continue;

        let dist = byIri.get(iri);
        if (!dist) {
            dist = {
                title: row.distTitle?.value || '',
                accessUrl: row.accessURL?.value || '',
                mediaType: row.mediaType?.value || '',
                format: row.format?.value || '',
                dataStandard: null,
            };
            byIri.set(iri, dist);
            if (!byDataset.has(datasetId)) byDataset.set(datasetId, []);
            byDataset.get(datasetId).push(dist);
        }

        const conformsTo = row.stdConformsTo?.value || '';
        const label = row.stdLabel?.value || '';
        if (conformsTo || label) {
            dist.dataStandard = dist.dataStandard || { label: '', conformsTo: '', version: '', schema: [] };
            dist.dataStandard.label = label || dist.dataStandard.label;
            dist.dataStandard.conformsTo = conformsTo || dist.dataStandard.conformsTo;
            dist.dataStandard.version = row.stdVersion?.value || dist.dataStandard.version;
        }
        const schema = row.schema?.value;
        if (schema && dist.dataStandard && !dist.dataStandard.schema.includes(schema)) {
            dist.dataStandard.schema.push(schema);
        }
    }

    return byDataset;
}

// ---------------------------------------------------------------------------
// Search: full parameterized SPARQL SELECT
// Returns an array of result objects.
// ---------------------------------------------------------------------------

async function semanticSearch({
    searchText = '',
    sessionCode = null,
    publisherBpns = null,
    datasetIds = null,
    policyName = null,
    dcatFilters = {},
    dcatFieldFilters = [],
    schemaProfiles = null,
    limit = 25
}) {
    const filters = [];
    const safe = escapeLiteral;

    if (searchText) {
        filters.push(`(
            CONTAINS(LCASE(STR(?title)), LCASE("${safe(searchText)}")) ||
            CONTAINS(LCASE(STR(COALESCE(?description, ""))), LCASE("${safe(searchText)}")) ||
            CONTAINS(LCASE(STR(COALESCE(?keyword, ""))), LCASE("${safe(searchText)}")) ||
            CONTAINS(LCASE(STR(COALESCE(?theme, ""))), LCASE("${safe(searchText)}"))
        )`);
    }
    if (sessionCode) {
        filters.push(`STR(COALESCE(?sessionCode, "")) = "${safe(sessionCode)}"`);
    }
    if (publisherBpns && publisherBpns.length > 0) {
        const bpnList = publisherBpns.map(b => `"${safe(b)}"`).join(', ');
        filters.push(`STR(?publisherBpn) IN (${bpnList})`);
    }
    if (datasetIds && datasetIds.length > 0) {
        const datasetList = datasetIds.map(id => `"${safe(id)}"`).join(', ');
        filters.push(`STR(?datasetId) IN (${datasetList})`);
    }
    if (policyName) {
        filters.push(`CONTAINS(LCASE(STR(COALESCE(?policyName, ""))), LCASE("${safe(policyName)}"))`);
    }
    if (dcatFilters.keyword) {
        filters.push(`CONTAINS(LCASE(STR(COALESCE(?keyword, ""))), LCASE("${safe(dcatFilters.keyword)}"))`);
    }
    if (dcatFilters.theme) {
        filters.push(`CONTAINS(LCASE(STR(COALESCE(?theme, ""))), LCASE("${safe(dcatFilters.theme)}"))`);
    }
    if (dcatFilters.spatial) {
        filters.push(`CONTAINS(LCASE(STR(COALESCE(?spatialValue, ""))), LCASE("${safe(dcatFilters.spatial)}"))`);
    }

    const fieldTriples = [];
    (Array.isArray(dcatFieldFilters) ? dcatFieldFilters : []).forEach((entry, idx) => {
        const key = entry?.key;
        const value = String(entry?.value || '').trim();
        const predicate = DCAT_FIELD_TO_PREDICATE[key];
        if (!predicate || !value) return;
        const varName = `?f${idx}`;
        fieldTriples.push(`?dataset <${predicate}> ${varName} .`);
        filters.push(`CONTAINS(LCASE(STR(${varName})), LCASE("${safe(value)}"))`);
    });

    // The schema a distribution declares is two hops from the dataset, so this
    // cannot go through DCAT_FIELD_TO_PREDICATE like the one-hop filters above.
    // Set membership rather than substring: a profile IRI either is or is not
    // the one asked for, and VALUES lets the store do that join.
    const schemaSet = Array.isArray(schemaProfiles)
        ? [...new Set(schemaProfiles.map(p => escapeIri(p)).filter(Boolean))]
        : [];
    const schemaTriples = schemaSet.length > 0
        ? [
            `?dataset <${P.distribution}>/<${P.mobilityDataStandard}>/<${P.schema}> ?schemaMatch .`,
            `VALUES ?schemaMatch { ${schemaSet.map(p => `<${p}>`).join(' ')} }`,
        ]
        : [];

    const whereFilter = filters.length > 0 ? `FILTER(${filters.join(' && ')})` : '';
    const maxLimit = Math.max(1, Math.min(Number(limit) || 25, 200));

    // Every mapped field is projected, not just the handful the query used to
    // hardcode. A field could previously be filtered on and have its value
    // discarded by the same query (US-3).
    const projectionKeys = Object.keys(DCAT_FIELD_TO_PREDICATE);
    const projectionOptionals = projectionKeys
        .filter(key => !DCAT_QUERY_VARS[key])
        .map(key => `OPTIONAL { ?dataset <${DCAT_FIELD_TO_PREDICATE[key]}> ?${dcatQueryVar(key)} . }`)
        .join('\n        ');
    const projectionSelects = projectionKeys
        .map(key => `       (GROUP_CONCAT(DISTINCT STR(?${dcatQueryVar(key)}); separator="${MULTI_VALUE_SEPARATOR}") AS ?${dcatResultVar(key)})`)
        .join('\n');

    const query = `
SELECT ?datasetId ?title ?description ?publisherBpn ?publisherName ?policyName ?publishedAt ?sessionCode
${projectionSelects}
WHERE {
    GRAPH ?g {
        ?dataset a <http://www.w3.org/ns/dcat#Dataset> ;
            <http://purl.org/dc/terms/identifier> ?datasetId ;
            <http://purl.org/dc/terms/title> ?title ;
            <http://purl.org/dc/terms/publisher> ?publisher ;
            <http://purl.org/dc/terms/issued> ?publishedAt .

        ?publisher <http://purl.org/dc/terms/identifier> ?publisherBpn .
        OPTIONAL { ?publisher <http://xmlns.com/foaf/0.1/name> ?publisherName . }
        OPTIONAL { ?dataset <http://purl.org/dc/terms/description> ?description . }
        OPTIONAL { ?dataset <http://www.w3.org/ns/dcat#keyword> ?keyword . }
        OPTIONAL { ?dataset <http://www.w3.org/ns/dcat#theme> ?theme . }
        OPTIONAL { ?dataset <http://purl.org/dc/terms/spatial> ?spatialValue . }
        OPTIONAL { ?dataset <http://purl.org/dc/terms/temporal> ?temporalValue . }
        OPTIONAL { ?dataset <http://www.w3.org/ns/odrl/2/policy> ?policyName . }
        OPTIONAL { ?dataset <http://purl.org/dc/terms/isPartOf> ?sessionCode . }
        ${projectionOptionals}
        ${fieldTriples.join('\n        ')}
        ${schemaTriples.join('\n        ')}
    }
    ${whereFilter}
}
GROUP BY ?datasetId ?title ?description ?publisherBpn ?publisherName ?policyName ?publishedAt ?sessionCode
ORDER BY DESC(?publishedAt)
LIMIT ${maxLimit}`;

    const bindings = await executeSelect(query);
    const results = bindings.map(row => {
        const dcat = {};
        for (const key of projectionKeys) {
            const values = splitMultiValue(row[dcatResultVar(key)]?.value);
            if (values.length > 0) {
                dcat[key] = values;
            }
        }
        return {
            datasetId: row.datasetId?.value || '',
            title: row.title?.value || '',
            description: row.description?.value || '',
            publisherBpn: row.publisherBpn?.value || '',
            publisherName: row.publisherName?.value || '',
            policyName: row.policyName?.value || '',
            publishedAt: row.publishedAt?.value || '',
            sessionCode: row.sessionCode?.value || '',
            spatial: dcat['dct:spatial'] || [],
            temporalCoverage: (dcat['dct:temporal'] || [])[0] || '',
            keywords: dcat['dcat:keyword'] || [],
            themes: dcat['dcat:theme'] || [],
            dcat,
            distributions: [],
        };
    });

    const distributions = await distributionsForDatasets(results.map(r => r.datasetId));
    for (const result of results) {
        result.distributions = distributions.get(result.datasetId) || [];
    }
    return results;
}

module.exports = {
    upsertSemanticDataset,
    deleteSemanticDataset,
    deleteSemanticDatasetsForParticipant,
    semanticSearch,
    distributionsForDatasets,
    executeSelect,
    executeUpdate,
    replaceGraph,
    dropGraph,
    escapeIri,
    escapeLiteral,
    DCAT_FIELD_TO_PREDICATE,
};
