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

const FUSEKI_URL = process.env.FUSEKI_URL || 'http://sim-fuseki:3030';
const FUSEKI_DATASET = process.env.FUSEKI_DATASET || 'simulator';
const FUSEKI_USERNAME = process.env.FUSEKI_USERNAME || '';
const FUSEKI_PASSWORD = process.env.FUSEKI_PASSWORD || '';
const UPDATE_ENDPOINT = `${FUSEKI_URL}/${FUSEKI_DATASET}/update`;
const QUERY_ENDPOINT = `${FUSEKI_URL}/${FUSEKI_DATASET}/sparql`;

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
};

// mobilityDCAT-AP 1.1.0 (NAPCORE Recommendation, January 2025). A Distribution
// must declare the data standard its payload follows, and that standard may
// point at the schema registry the profile asks for — which is the hook the
// Vocabulary Hub resolves.
const MDCAT = 'https://w3id.org/mobilitydcat-ap#';
const PREDICATES = {
    distribution: 'http://www.w3.org/ns/dcat#distribution',
    accessURL: 'http://www.w3.org/ns/dcat#accessURL',
    mediaType: 'http://www.w3.org/ns/dcat#mediaType',
    title: 'http://purl.org/dc/terms/title',
    format: 'http://purl.org/dc/terms/format',
    conformsTo: 'http://purl.org/dc/terms/conformsTo',
    versionInfo: 'http://www.w3.org/2002/07/owl#versionInfo',
    mobilityDataStandard: `${MDCAT}mobilityDataStandard`,
    mobilityDataStandardClass: `${MDCAT}MobilityDataStandard`,
    schema: `${MDCAT}schema`,
    distributionClass: 'http://www.w3.org/ns/dcat#Distribution',
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

function distributionIri(datasetId, index) {
    return `urn:distribution:${encodeURIComponent(datasetId)}:${index}`;
}

function dataStandardIri(datasetId, index) {
    return `urn:datastandard:${encodeURIComponent(datasetId)}:${index}`;
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
// Distributions
//
// A distribution is a node of its own, not a literal on the dataset, because
// mobilityDCAT-AP puts the mandatory mobilityDataStandard there. Its IRI is
// derived from the dataset IRI so a re-publish can find and replace it.
// ---------------------------------------------------------------------------

function distributionTriples(datasetId, distributions) {
    const dsIri = datasetIri(datasetId);
    const triples = [];

    distributions.forEach((dist, index) => {
        const distIri = distributionIri(datasetId, index);
        triples.push(`<${dsIri}> <${PREDICATES.distribution}> <${distIri}> .`);
        triples.push(`<${distIri}> a <${PREDICATES.distributionClass}> .`);

        if (dist.title) triples.push(`<${distIri}> <${PREDICATES.title}> "${escapeLiteral(dist.title)}" .`);
        if (dist.accessUrl) triples.push(`<${distIri}> <${PREDICATES.accessURL}> <${escapeIri(dist.accessUrl)}> .`);
        if (dist.mediaType) triples.push(`<${distIri}> <${PREDICATES.mediaType}> "${escapeLiteral(dist.mediaType)}" .`);
        if (dist.format) triples.push(`<${distIri}> <${PREDICATES.format}> "${escapeLiteral(dist.format)}" .`);

        const standard = dist.dataStandard;
        if (!standard) return;

        const stdIri = dataStandardIri(datasetId, index);
        triples.push(`<${distIri}> <${PREDICATES.mobilityDataStandard}> <${stdIri}> .`);
        triples.push(`<${stdIri}> a <${PREDICATES.mobilityDataStandardClass}> .`);
        if (standard.conformsTo) {
            triples.push(`<${stdIri}> <${PREDICATES.conformsTo}> <${escapeIri(standard.conformsTo)}> .`);
        }
        if (standard.label) {
            triples.push(`<${stdIri}> <${PREDICATES.title}> "${escapeLiteral(standard.label)}" .`);
        }
        if (standard.version) {
            triples.push(`<${stdIri}> <${PREDICATES.versionInfo}> "${escapeLiteral(standard.version)}" .`);
        }
        for (const schema of (standard.schema ? [].concat(standard.schema) : [])) {
            triples.push(`<${stdIri}> <${PREDICATES.schema}> <${escapeIri(schema)}> .`);
        }
    });

    return triples;
}

// Deleting `<dataset> ?p ?o` alone would strand the distribution and standard
// nodes, which keep matching searches long after the dataset is gone. Deepest
// hop first, because each step is found through the link the next one removes.
function cascadeDeleteFor(subjectPattern) {
    return [
        `DELETE { GRAPH ?g { ?std ?sp ?so } }
WHERE  { GRAPH ?g { ${subjectPattern} <${PREDICATES.distribution}> ?dist .
                    ?dist <${PREDICATES.mobilityDataStandard}> ?std .
                    ?std ?sp ?so } }`,
        `DELETE { GRAPH ?g { ?dist ?dp ?do } }
WHERE  { GRAPH ?g { ${subjectPattern} <${PREDICATES.distribution}> ?dist .
                    ?dist ?dp ?do } }`,
    ];
}

// ---------------------------------------------------------------------------
// Upsert a dataset (delete all existing triples for this IRI, then insert fresh)
// dataset: {
//   datasetId, title, description, keywords[], themes[], spatial[], temporalCoverage,
//   additionalDcat: [{ key, value }],
//   distributions: [{ title, accessUrl, mediaType, format,
//                     dataStandard: { conformsTo, label, version, schema } }],
//   policyName, publisherBpn, publisherName, sessionCode, publishedAt
// }
// ---------------------------------------------------------------------------

async function upsertSemanticDataset(dataset) {
    const dsIri = datasetIri(dataset.datasetId);
    const pubIri = participantIri(dataset.publisherBpn);
    const graphIri = graphIriForDataset(dataset);

    // Collect all triples to insert
    const triples = [
        `<${dsIri}> a <http://www.w3.org/ns/dcat#Dataset> .`,
        `<${dsIri}> <http://purl.org/dc/terms/identifier> "${escapeLiteral(dataset.datasetId)}" .`,
        `<${dsIri}> <http://purl.org/dc/terms/title> "${escapeLiteral(dataset.title)}" .`,
        `<${dsIri}> <http://purl.org/dc/terms/publisher> <${pubIri}> .`,
        `<${dsIri}> <http://purl.org/dc/terms/issued> "${escapeLiteral(dataset.publishedAt)}" .`,
        `<${pubIri}> <http://purl.org/dc/terms/identifier> "${escapeLiteral(dataset.publisherBpn)}" .`,
        `<${pubIri}> <http://xmlns.com/foaf/0.1/name> "${escapeLiteral(dataset.publisherName || dataset.publisherBpn)}" .`,
    ];

    if (dataset.description) {
        triples.push(`<${dsIri}> <http://purl.org/dc/terms/description> "${escapeLiteral(dataset.description)}" .`);
    }
    if (dataset.policyName) {
        triples.push(`<${dsIri}> <http://www.w3.org/ns/odrl/2/policy> "${escapeLiteral(dataset.policyName)}" .`);
    }
    if (dataset.sessionCode) {
        triples.push(`<${dsIri}> <http://purl.org/dc/terms/isPartOf> "${escapeLiteral(dataset.sessionCode)}" .`);
    }
    if (dataset.temporalCoverage) {
        triples.push(`<${dsIri}> <http://purl.org/dc/terms/temporal> "${escapeLiteral(dataset.temporalCoverage)}" .`);
    }

    for (const kw of (dataset.keywords || [])) {
        triples.push(`<${dsIri}> <http://www.w3.org/ns/dcat#keyword> "${escapeLiteral(kw)}" .`);
    }
    for (const th of (dataset.themes || [])) {
        triples.push(`<${dsIri}> <http://www.w3.org/ns/dcat#theme> "${escapeLiteral(th)}" .`);
    }
    for (const sp of (dataset.spatial || [])) {
        triples.push(`<${dsIri}> <http://purl.org/dc/terms/spatial> "${escapeLiteral(sp)}" .`);
    }

    // Additional DCAT fields from the dynamic UI form
    for (const entry of (dataset.additionalDcat || [])) {
        const predicate = DCAT_FIELD_TO_PREDICATE[entry.key];
        if (predicate && entry.value) {
            triples.push(`<${dsIri}> <${predicate}> "${escapeLiteral(entry.value)}" .`);
        }
    }

    triples.push(...distributionTriples(dataset.datasetId, dataset.distributions || []));

    const updateQuery = `
${cascadeDeleteFor(`<${dsIri}>`).join(' ;\n\n')} ;

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
    const q = `${cascadeDeleteFor(`<${dsIri}>`).join(' ;\n\n')} ;

DELETE { GRAPH ?g { <${dsIri}> ?p ?o } } WHERE { GRAPH ?g { <${dsIri}> ?p ?o } }`;
    await executeUpdate(q);
}

// ---------------------------------------------------------------------------
// Delete all datasets for a publisher BPN
// ---------------------------------------------------------------------------

async function deleteSemanticDatasetsForParticipant(publisherBpn) {
    const pubIri = participantIri(publisherBpn);
    const owned = `?ds <http://purl.org/dc/terms/publisher> <${pubIri}> . ?ds`;
    const q = `
${cascadeDeleteFor(owned).join(' ;\n\n')} ;

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
    }
    ${whereFilter}
}
GROUP BY ?datasetId ?title ?description ?publisherBpn ?publisherName ?policyName ?publishedAt ?sessionCode
ORDER BY DESC(?publishedAt)
LIMIT ${maxLimit}`;

    const bindings = await executeSelect(query);
    return bindings.map(row => {
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
        };
    });
}

module.exports = {
    upsertSemanticDataset,
    deleteSemanticDataset,
    deleteSemanticDatasetsForParticipant,
    semanticSearch,
    DCAT_FIELD_TO_PREDICATE,
};
