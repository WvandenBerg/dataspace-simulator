/**
 * catalogprofiles.js — the catalog profiles a dataspace's hub holds as files.
 *
 * A catalog profile is the data model for catalog entries: DCAT-AP or one of
 * its application profiles, given as SHACL shapes plus optional vocabulary
 * files. The files are kept verbatim in SQLite, the source of truth. Each one
 * is also loaded into a named graph of its own so it can be queried, and the
 * hub learns about them through descriptions in one uploads graph.
 *
 * owl:imports is never followed. A profile that imports another must ship the
 * imported file too; the inspection report says which imports went unresolved.
 */

const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { executeSelect, replaceGraph, dropGraph, escapeIri, escapeLiteral } = require('./semantic');

const MEDIA_TYPES = {
    '.ttl': 'text/turtle',
    '.n3': 'text/n3',
    '.nt': 'application/n-triples',
    '.jsonld': 'application/ld+json',
    '.json': 'application/ld+json',
    '.rdf': 'application/rdf+xml',
    '.owl': 'application/rdf+xml',
    '.xml': 'application/rdf+xml',
};
const ROLES = new Set(['validation', 'vocabulary']);
const MAX_FILES = 20;
const SH = 'http://www.w3.org/ns/shacl#';

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
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    dcatap: 'http://data.europa.eu/r5r/',
    prov: 'http://www.w3.org/ns/prov#',
    odrl: 'http://www.w3.org/ns/odrl/2/',
    spdx: 'http://spdx.org/rdf/terms#',
    dqv: 'http://www.w3.org/ns/dqv#',
    cnt: 'http://www.w3.org/2011/content#',
};

class ProfileError extends Error {}

const enc = (dataspaceId) => encodeURIComponent(dataspaceId);
const uploadsGraph = (dataspaceId) => `urn:graph:vocabhub:${enc(dataspaceId)}:uploads`;
const artifactGraph = (dataspaceId, artifactId) => `urn:graph:vocabhub:${enc(dataspaceId)}:artifact:${artifactId}`;
const artifactIri = (dataspaceId, artifactId) => `urn:vocabhub:artifact:${enc(dataspaceId)}:${artifactId}`;
const resourceIri = (dataspaceId, artifactId) => `urn:vocabhub:resource:${enc(dataspaceId)}:${artifactId}`;
const val = (row, key) => row[key]?.value;

function curie(iri) {
    for (const [prefix, ns] of Object.entries(PREFIXES)) {
        if (iri.startsWith(ns)) return `${prefix}:${iri.slice(ns.length)}`;
    }
    return iri;
}

function fromClause(graphs) {
    return graphs.map((g) => `FROM <${g}>`).join('\n');
}

// ---------------------------------------------------------------------------
// The uploads graph: what the hub knows about profiles that came as files
// ---------------------------------------------------------------------------

function uploadsTurtle(dataspaceId) {
    const lines = [
        '@prefix dcterms: <http://purl.org/dc/terms/> .',
        '@prefix owl: <http://www.w3.org/2002/07/owl#> .',
        '@prefix prof: <http://www.w3.org/ns/dx/prof/> .',
        '@prefix role: <http://www.w3.org/ns/dx/prof/role/> .',
        '',
    ];
    for (const p of db.getHubProfiles(dataspaceId)) {
        if (!p.title) continue;
        lines.push(`<${escapeIri(p.profile_id)}> a prof:Profile ;`);
        if (p.description) lines.push(`    dcterms:description "${escapeLiteral(p.description)}" ;`);
        if (p.version) lines.push(`    owl:versionInfo "${escapeLiteral(p.version)}" ;`);
        lines.push(`    dcterms:title "${escapeLiteral(p.title)}" .`);
    }
    for (const a of db.getHubArtifacts(dataspaceId)) {
        const resource = resourceIri(dataspaceId, a.artifact_id);
        lines.push(`<${escapeIri(a.profile_id)}> prof:hasResource <${resource}> .`);
        lines.push(`<${resource}> a prof:ResourceDescriptor ;`);
        lines.push(`    prof:hasRole role:${a.role} ;`);
        lines.push(`    prof:hasArtifact <${artifactIri(dataspaceId, a.artifact_id)}> ;`);
        lines.push(`    dcterms:title "${escapeLiteral(a.file_name)}" ;`);
        lines.push(`    dcterms:format "${escapeLiteral(a.media_type)}" .`);
    }
    return lines.join('\n');
}

async function writeUploadsGraph(dataspaceId) {
    await replaceGraph(uploadsGraph(dataspaceId), uploadsTurtle(dataspaceId));
}

// ---------------------------------------------------------------------------
// Inspecting one loaded file
// ---------------------------------------------------------------------------

async function inspect(graph) {
    const rows = await executeSelect(`
PREFIX sh: <${SH}>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
SELECT ?kind ?value
FROM <${graph}>
WHERE {
  { ?value a sh:NodeShape . BIND('shape' AS ?kind) }
  UNION { ?s sh:targetClass ?value . BIND('target' AS ?kind) }
  UNION { ?value a owl:Ontology . BIND('ontology' AS ?kind) }
  UNION { ?o owl:imports ?value . BIND('import' AS ?kind) }
}`);
    const of = (kind) => [...new Set(rows.filter((r) => val(r, 'kind') === kind).map((r) => val(r, 'value')))];
    return { shapes: of('shape').length, targetClasses: of('target'), ontologies: of('ontology'), imports: of('import') };
}

// ---------------------------------------------------------------------------
// Adding and removing profiles
// ---------------------------------------------------------------------------

function checkFiles(files) {
    if (!Array.isArray(files) || files.length === 0) throw new ProfileError('Add at least one file');
    if (files.length > MAX_FILES) throw new ProfileError(`At most ${MAX_FILES} files per profile`);
    return files.map((f) => {
        const name = path.basename(String(f?.name || ''));
        const mediaType = MEDIA_TYPES[path.extname(name).toLowerCase()];
        if (!name || !mediaType) throw new ProfileError(`${name || 'A file'}: not an RDF file this hub reads (${Object.keys(MEDIA_TYPES).join(', ')})`);
        if (typeof f.content !== 'string' || !f.content.trim()) throw new ProfileError(`${name}: empty file`);
        if (f.role !== undefined && !ROLES.has(f.role)) throw new ProfileError(`${name}: role must be validation or vocabulary`);
        return { name, mediaType, content: f.content, role: f.role };
    });
}

function parseMessage(err) {
    const body = err.response?.data;
    return String(typeof body === 'string' && body.trim() ? body : err.message).split('\n')[0].slice(0, 300);
}

async function addProfile(dataspaceId, { profileId, title, version, description, files, source = 'upload', artifactIds }) {
    const checked = checkFiles(files);
    const id = profileId || `urn:vocabhub:profile:upload:${crypto.randomUUID()}`;
    if (!profileId && !String(title || '').trim()) throw new ProfileError('A new profile needs a title');

    const loaded = [];
    try {
        for (const [i, file] of checked.entries()) {
            const artifactId = artifactIds?.[i] || crypto.randomUUID();
            const graph = artifactGraph(dataspaceId, artifactId);
            let tripleCount;
            try {
                tripleCount = await replaceGraph(graph, file.content, file.mediaType);
            } catch (err) {
                if (err.response?.status === 400) throw new ProfileError(`${file.name}: ${parseMessage(err)}`);
                throw err;
            }
            loaded.push({ ...file, artifactId, graph, tripleCount, ...(await inspect(graph)) });
        }
    } catch (err) {
        await Promise.all(loaded.map((f) => dropGraph(f.graph)));
        throw err;
    }

    // An import counts as resolved when another file in the same profile is
    // that ontology, or carries the file name the import points at.
    const ontologies = new Set(loaded.flatMap((f) => f.ontologies));
    const names = new Set(loaded.map((f) => f.name));
    const createdAt = new Date().toISOString();
    const report = loaded.map((f) => ({
        artifactId: f.artifactId,
        name: f.name,
        role: f.role || (f.shapes > 0 ? 'validation' : 'vocabulary'),
        tripleCount: f.tripleCount,
        shapes: f.shapes,
        targetClasses: f.targetClasses.map(curie),
        unresolvedImports: f.imports.filter((iri) => !ontologies.has(iri) && !names.has(iri.split('/').pop())),
    }));

    const existing = db.getHubProfile(dataspaceId, id);
    db.saveHubProfile(
        {
            dataspace_id: dataspaceId,
            profile_id: id,
            title: String(title || '').trim() || existing?.title || null,
            version: String(version || '').trim() || existing?.version || null,
            description: String(description || '').trim() || existing?.description || null,
            source,
            created_at: existing?.created_at || createdAt,
        },
        report.map((r, i) => ({
            dataspace_id: dataspaceId,
            artifact_id: r.artifactId,
            profile_id: id,
            role: r.role,
            file_name: r.name,
            media_type: loaded[i].mediaType,
            content: loaded[i].content,
            created_at: createdAt,
        })),
    );
    await writeUploadsGraph(dataspaceId);

    return { profileId: id, files: report };
}

async function removeProfile(dataspaceId, profileId) {
    const artifacts = db.getHubArtifacts(dataspaceId).filter((a) => a.profile_id === profileId);
    await Promise.all(artifacts.map((a) => dropGraph(artifactGraph(dataspaceId, a.artifact_id))));
    db.removeHubProfile(dataspaceId, profileId);
    await writeUploadsGraph(dataspaceId);
}

function listFileProfiles(dataspaceId) {
    const artifacts = db.getHubArtifacts(dataspaceId);
    return db.getHubProfiles(dataspaceId).map((p) => ({
        id: p.profile_id,
        source: p.source,
        files: artifacts
            .filter((a) => a.profile_id === p.profile_id)
            .map((a) => ({ artifactId: a.artifact_id, name: a.file_name, role: a.role, mediaType: a.media_type })),
    }));
}

module.exports = {
    ProfileError,
    uploadsGraph,
    addProfile,
    removeProfile,
    listFileProfiles,
    artifact: (dataspaceId, artifactId) => db.getHubArtifact(dataspaceId, artifactId),
};
