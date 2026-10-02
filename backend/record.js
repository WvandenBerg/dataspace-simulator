/**
 * record.js — a catalog entry as data, independent of any one profile.
 *
 * A record maps property IRIs to lists of values. A value is an IRI, a literal,
 * or a nested node with a record of its own, so a profile field nobody wrote
 * code for is stored and read back exactly like the ones somebody did:
 *
 *   { 'http://purl.org/dc/terms/title': [{ value: 'Traffic counts' }],
 *     'http://www.w3.org/ns/dcat#theme': [{ iri: 'http://…/TRAN' }],
 *     'http://www.w3.org/ns/dcat#distribution': [{ type: 'http://…#Distribution', fields: { … } }] }
 */

const PREFIXES = {
    dcat: 'http://www.w3.org/ns/dcat#',
    dct: 'http://purl.org/dc/terms/',
    foaf: 'http://xmlns.com/foaf/0.1/',
    skos: 'http://www.w3.org/2004/02/skos/core#',
    mobilitydcatap: 'https://w3id.org/mobilitydcat-ap#',
    adms: 'http://www.w3.org/ns/adms#',
    vcard: 'http://www.w3.org/2006/vcard/ns#',
    locn: 'http://www.w3.org/ns/locn#',
    owl: 'http://www.w3.org/2002/07/owl#',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    dcatap: 'http://data.europa.eu/r5r/',
    prov: 'http://www.w3.org/ns/prov#',
    odrl: 'http://www.w3.org/ns/odrl/2/',
    spdx: 'http://spdx.org/rdf/terms#',
    dqv: 'http://www.w3.org/ns/dqv#',
    cnt: 'http://www.w3.org/2011/content#',
};

const RDF_TYPE = `${PREFIXES.rdf}type`;
const P = {
    title: `${PREFIXES.dct}title`,
    description: `${PREFIXES.dct}description`,
    keyword: `${PREFIXES.dcat}keyword`,
    theme: `${PREFIXES.dcat}theme`,
    spatial: `${PREFIXES.dct}spatial`,
    temporal: `${PREFIXES.dct}temporal`,
    distribution: `${PREFIXES.dcat}distribution`,
    distributionClass: `${PREFIXES.dcat}Distribution`,
    accessURL: `${PREFIXES.dcat}accessURL`,
    mediaType: `${PREFIXES.dcat}mediaType`,
    format: `${PREFIXES.dct}format`,
    conformsTo: `${PREFIXES.dct}conformsTo`,
    versionInfo: `${PREFIXES.owl}versionInfo`,
    mobilityDataStandard: `${PREFIXES.mobilitydcatap}mobilityDataStandard`,
    mobilityDataStandardClass: `${PREFIXES.mobilitydcatap}MobilityDataStandard`,
    schema: `${PREFIXES.mobilitydcatap}schema`,
};

function curie(iri) {
    for (const [prefix, ns] of Object.entries(PREFIXES)) {
        if (iri.startsWith(ns)) return `${prefix}:${iri.slice(ns.length)}`;
    }
    return iri;
}

function expand(term) {
    const [prefix, ...rest] = String(term || '').split(':');
    return PREFIXES[prefix] && rest.length > 0 ? PREFIXES[prefix] + rest.join(':') : term;
}

const literals = (values) => [].concat(values ?? []).map(String).map((v) => v.trim()).filter(Boolean).map((value) => ({ value }));
const iris = (values) => [].concat(values ?? []).map(String).map((v) => v.trim()).filter(Boolean).map((iri) => ({ iri }));
const list = (value) => (typeof value === 'string' ? value.split(',') : value);

function put(record, path, values) {
    if (values.length > 0) record[path] = [...(record[path] || []), ...values];
}

function standardNode(standard) {
    const fields = {};
    put(fields, P.title, literals(standard.label));
    put(fields, P.conformsTo, iris(standard.conformsTo));
    put(fields, P.versionInfo, literals(standard.version));
    put(fields, P.schema, iris(standard.schema));
    return { type: P.mobilityDataStandardClass, fields };
}

function distributionNode(dist) {
    const fields = {};
    put(fields, P.title, literals(dist.title));
    put(fields, P.accessURL, iris(dist.accessUrl));
    put(fields, P.mediaType, literals(dist.mediaType));
    put(fields, P.format, literals(dist.format));
    if (dist.dataStandard) put(fields, P.mobilityDataStandard, [standardNode(dist.dataStandard)]);
    return { type: P.distributionClass, fields };
}

// What the publish form stored before profiles drove it. A field the form
// filled per profile, under dcatFields.record, replaces the legacy one.
function assetToRecord({ title, description, dcatFields = {} }) {
    const record = {};
    put(record, P.title, literals(title));
    put(record, P.description, literals(description));
    put(record, P.keyword, literals(list(dcatFields.keywords)));
    put(record, P.theme, literals(list(dcatFields.themes)));
    put(record, P.spatial, literals(list(dcatFields.spatial)));
    put(record, P.temporal, literals(dcatFields.temporalCoverage));
    for (const entry of dcatFields.additionalDcat || []) {
        const path = expand(entry?.key);
        if (path !== entry?.key) put(record, path, literals(entry?.value));
    }
    put(record, P.distribution, (dcatFields.distributions || []).map(distributionNode));
    return { ...record, ...cleanRecord(dcatFields.record) };
}

const IRI = /^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]+$/i;
const MAX_DEPTH = 4;

// A record arrives from the browser, so anything that is not one is dropped
// rather than written to the store.
function cleanRecord(raw, depth = 0) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > MAX_DEPTH) return {};
    const record = {};
    for (const [path, values] of Object.entries(raw)) {
        if (!IRI.test(path) || !Array.isArray(values)) continue;
        put(record, path, values.map((v) => cleanValue(v, depth)).filter(Boolean));
    }
    return record;
}

function cleanValue(v, depth) {
    if (!v || typeof v !== 'object') return null;
    if (typeof v.iri === 'string') return IRI.test(v.iri.trim()) ? { iri: v.iri.trim() } : null;
    if (typeof v.value === 'string' || typeof v.value === 'number') {
        const value = String(v.value).trim();
        if (!value) return null;
        return {
            value,
            ...(typeof v.lang === 'string' && /^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(v.lang) ? { lang: v.lang } : {}),
            ...(typeof v.datatype === 'string' && IRI.test(v.datatype) ? { datatype: v.datatype } : {}),
        };
    }
    if (v.fields) {
        const fields = cleanRecord(v.fields, depth + 1);
        if (Object.keys(fields).length === 0) return null;
        return { ...(typeof v.type === 'string' && IRI.test(v.type) ? { type: v.type } : {}), fields };
    }
    return null;
}

module.exports = { PREFIXES, RDF_TYPE, P, curie, expand, assetToRecord };
