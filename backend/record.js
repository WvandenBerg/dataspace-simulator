/**
 * record.js — a catalog entry as data, independent of any one profile.
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

function curie(iri) {
    for (const [prefix, ns] of Object.entries(PREFIXES)) {
        if (iri.startsWith(ns)) return `${prefix}:${iri.slice(ns.length)}`;
    }
    return iri;
}

module.exports = { PREFIXES, curie };
