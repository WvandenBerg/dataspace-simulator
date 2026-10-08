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
const fs = require('fs');
const path = require('path');
const db = require('./db');
const scenarios = require('./scenarios');
const { executeSelect, replaceGraph, dropGraph, escapeIri, escapeLiteral } = require('./semantic');
const { curie, P } = require('./record');

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
const MAX_DEPTH = 3;
const DATASET = 'http://www.w3.org/ns/dcat#Dataset';
const CONCEPT = 'http://www.w3.org/2004/02/skos/core#Concept';
const SH = 'http://www.w3.org/ns/shacl#';

class ProfileError extends Error {}

const enc = (dataspaceId) => encodeURIComponent(dataspaceId);
const uploadsGraph = (dataspaceId) => `urn:graph:vocabhub:${enc(dataspaceId)}:uploads`;
const artifactGraph = (dataspaceId, artifactId) => `urn:graph:vocabhub:${enc(dataspaceId)}:artifact:${artifactId}`;
const artifactIri = (dataspaceId, artifactId) => `urn:vocabhub:artifact:${enc(dataspaceId)}:${artifactId}`;
const resourceIri = (dataspaceId, artifactId) => `urn:vocabhub:resource:${enc(dataspaceId)}:${artifactId}`;
const val = (row, key) => row[key]?.value;

function humanize(iri) {
    const local = iri.split(/[#/:]/).filter(Boolean).pop() || iri;
    const words = local.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
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

async function addProfile(dataspaceId, { profileId, title, version, description, files, source = 'upload', artifactIds, dataStandardPath }) {
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
        forgetModels(dataspaceId);
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
            data_standard_path: dataStandardPath !== undefined ? JSON.stringify(dataStandardPath) : (existing?.data_standard_path ?? null),
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
    forgetModels(dataspaceId);
    await writeUploadsGraph(dataspaceId);

    const model = await fieldModel(dataspaceId, id);
    return { profileId: id, files: report, fields: countFields(model.fields), dataStandard: model.dataStandard, unsupported: model.unsupported };
}

async function removeProfile(dataspaceId, profileId) {
    const artifacts = db.getHubArtifacts(dataspaceId).filter((a) => a.profile_id === profileId);
    await Promise.all(artifacts.map((a) => dropGraph(artifactGraph(dataspaceId, a.artifact_id))));
    db.removeHubProfile(dataspaceId, profileId);
    forgetModels(dataspaceId);
    await writeUploadsGraph(dataspaceId);
}

// Deterministic artifact ids keep a reloaded scenario from piling up copies. A
// data-standard field chosen in the hub survives the reload; the scenario's only seeds it.
async function installScenarioProfiles(dataspaceId, scenario) {
    const installed = [];
    for (const [k, spec] of (scenario.catalogProfiles || []).entries()) {
        const existing = db.getHubProfile(dataspaceId, spec.profileId);
        await removeProfile(dataspaceId, spec.profileId);
        installed.push(await addProfile(dataspaceId, {
            profileId: spec.profileId,
            title: spec.title,
            version: spec.version,
            description: spec.description,
            source: 'scenario',
            files: spec.files.map((rel) => ({ name: path.basename(rel), content: fs.readFileSync(scenarios.scenarioFile(rel), 'utf8') })),
            artifactIds: spec.files.map((_, i) => `${scenario.id}-${k}-${i}`),
            dataStandardPath: existing?.data_standard_path != null ? JSON.parse(existing.data_standard_path) : (spec.dataStandardPath ?? null),
        }));
    }
    return installed;
}

function artifactsOf(dataspaceId, profileId) {
    return db.getHubArtifacts(dataspaceId).filter((a) => a.profile_id === profileId);
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

// ---------------------------------------------------------------------------
// Field model: the catalog entry fields a profile's shapes define
// ---------------------------------------------------------------------------

const STATUS_RANK = { optional: 0, recommended: 1, mandatory: 2 };

function statusOf(min, severity) {
    if (severity === `${SH}Info`) return 'optional';
    if (severity === `${SH}Warning`) return 'recommended';
    return min >= 1 ? 'mandatory' : 'optional';
}

async function propertyRows(graphs) {
    return executeSelect(`
PREFIX sh: <${SH}>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT ?shape ?target ?prop ?path
       (SAMPLE(?n) AS ?name) (SAMPLE(?d) AS ?description) (MIN(?o) AS ?order)
       (MAX(?mn) AS ?min) (MIN(?mx) AS ?max) (SAMPLE(?dt) AS ?datatype) (SAMPLE(?cl) AS ?class)
       (SAMPLE(?ocl) AS ?orClass) (SAMPLE(?nk) AS ?nodeKind) (SAMPLE(?nd) AS ?node)
       (SAMPLE(?sv) AS ?severity) (MAX(?cx) AS ?complex)
       (GROUP_CONCAT(DISTINCT STR(?iv); separator="\u001F") AS ?inList)
${fromClause(graphs)}
WHERE {
  ?shape sh:property ?prop .
  ?prop sh:path ?path .
  FILTER(isIRI(?path))
  OPTIONAL { ?shape sh:targetClass ?target }
  OPTIONAL { ?prop sh:name ?n FILTER(lang(?n) = '' || langMatches(lang(?n), 'en')) }
  OPTIONAL { ?prop sh:description ?d FILTER(lang(?d) = '' || langMatches(lang(?d), 'en')) }
  OPTIONAL { ?prop sh:order ?o }
  OPTIONAL { ?prop sh:minCount ?mn }
  OPTIONAL { ?prop sh:maxCount ?mx }
  OPTIONAL { ?prop sh:datatype ?dt }
  OPTIONAL { ?prop sh:class ?cl }
  OPTIONAL { ?prop sh:or/rdf:rest*/rdf:first/sh:class ?ocl }
  OPTIONAL { ?prop sh:nodeKind ?nk }
  OPTIONAL { ?prop sh:node ?nd }
  OPTIONAL { ?prop sh:severity ?sv }
  OPTIONAL { ?prop sh:in/rdf:rest*/rdf:first ?iv }
  BIND(IF(EXISTS { ?prop sh:or|sh:and|sh:xone|sh:not ?x }, 1, 0) AS ?cx)
}
GROUP BY ?shape ?target ?prop ?path`);
}

// A node shape that only pins skos:inScheme restricts which terms are allowed;
// it describes a code list, not a structure to fill in.
async function codeLists(graphs) {
    const rows = await executeSelect(`
PREFIX sh: <${SH}>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?node ?scheme ${fromClause(graphs)}
WHERE { ?node sh:property ?p . ?p sh:path skos:inScheme ; sh:hasValue ?scheme }`);
    return new Map(rows.map((r) => [val(r, 'node'), val(r, 'scheme')]));
}

// GROUP_CONCAT loses the list's order, so the values come back sorted.
function inList(row) {
    const values = (val(row, 'inList') || '').split('\u001F').filter(Boolean);
    return values.length > 0 ? values.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : null;
}

async function labels(graphs, iris) {
    if (iris.length === 0) return new Map();
    const rows = await executeSelect(`
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?p (SAMPLE(?l) AS ?label) ${fromClause(graphs)}
WHERE {
  VALUES ?p { ${iris.map((i) => `<${escapeIri(i)}>`).join(' ')} }
  ?p rdfs:label|skos:prefLabel ?l FILTER(lang(?l) = '' || langMatches(lang(?l), 'en'))
}
GROUP BY ?p`);
    return new Map(rows.map((r) => [val(r, 'p'), val(r, 'label')]));
}

async function countNonIriPaths(graphs) {
    const rows = await executeSelect(`
PREFIX sh: <${SH}>
SELECT (COUNT(*) AS ?n) ${fromClause(graphs)} WHERE { ?prop sh:path ?p FILTER(!isIRI(?p)) }`);
    return Number(val(rows[0] || {}, 'n') || 0);
}

// Several shapes may constrain the same property of a class, as when a profile
// tightens its base. They merge into one field; the strictest bound wins.
function mergeInto(map, row, schemes) {
    const pathIri = val(row, 'path');
    const min = Number(val(row, 'min') || 0);
    const max = val(row, 'max') === undefined ? null : Number(val(row, 'max'));
    const field = map.get(pathIri) || {
        path: pathIri, curie: curie(pathIri), name: null, description: null, order: null,
        min: 0, max: null, datatype: null, class: null, orClass: null, nodeKind: null, node: null,
        status: 'optional', in: null, complex: false,
    };
    field.name = field.name || val(row, 'name') || null;
    field.description = field.description || val(row, 'description') || null;
    const order = val(row, 'order') === undefined ? null : Number(val(row, 'order'));
    if (order !== null && (field.order === null || order < field.order)) field.order = order;
    field.min = Math.max(field.min, min);
    if (max !== null) field.max = field.max === null ? max : Math.min(field.max, max);
    field.datatype = field.datatype || val(row, 'datatype') || null;
    field.class = field.class || val(row, 'class') || null;
    field.orClass = field.orClass || val(row, 'orClass') || null;
    field.nodeKind = field.nodeKind || val(row, 'nodeKind') || null;
    field.node = field.node || val(row, 'node') || null;
    field.in = field.in || inList(row);
    field.complex = field.complex || val(row, 'complex') === '1';
    // A warning that only steers which code-list term to use says nothing about whether to fill the field.
    const valueOnly = min === 0 && schemes.has(val(row, 'node'));
    const status = valueOnly ? 'optional' : statusOf(min, val(row, 'severity'));
    if (STATUS_RANK[status] > STATUS_RANK[field.status]) field.status = status;
    map.set(pathIri, field);
}

function countFields(fields) {
    return fields.reduce((n, f) => n + 1 + countFields(f.fields || []), 0);
}

// Building a model takes several queries over the shapes, which change only with the hub's profiles.
const models = new Map();

function cachedModel(key, build) {
    if (!models.has(key)) {
        models.set(key, build().catch((err) => {
            models.delete(key);
            throw err;
        }));
    }
    return models.get(key);
}

function forgetModels(dataspaceId) {
    for (const key of models.keys()) if (key.startsWith(`${dataspaceId}\n`)) models.delete(key);
}

async function fieldModel(dataspaceId, profileId) {
    return cachedModel(`${dataspaceId}\n${profileId}`, async () => {
        const artifacts = artifactsOf(dataspaceId, profileId);
        if (!artifacts.some((a) => a.role === 'validation')) return null;
        const stored = db.getHubProfile(dataspaceId, profileId)?.data_standard_path;
        return modelFromGraphs(profileId, artifacts.map((a) => artifactGraph(dataspaceId, a.artifact_id)), stored ? JSON.parse(stored) : null);
    });
}

async function modelFromGraphs(profileId, graphs, dataStandardPath = null) {
    const [rows, nonIriPaths, schemes] = await Promise.all([
        propertyRows(graphs), countNonIriPaths(graphs), codeLists(graphs),
    ]);
    const byClass = new Map();
    const byShape = new Map();
    for (const row of rows) {
        const shape = val(row, 'shape');
        if (!byShape.has(shape)) byShape.set(shape, new Map());
        mergeInto(byShape.get(shape), row, schemes);
        const target = val(row, 'target');
        if (target) {
            if (!byClass.has(target)) byClass.set(target, new Map());
            mergeInto(byClass.get(target), row, schemes);
        }
    }

    const nameOf = await labels(graphs, [...new Set(rows.map((r) => val(r, 'path')))]);
    const order = (a, b) => (a.order ?? 999) - (b.order ?? 999)
        || STATUS_RANK[b.status] - STATUS_RANK[a.status]
        || a.label.localeCompare(b.label);

    // A class mentioned only inside sh:or still says what structure a value may
    // have. skos:Concept values are code-list terms, referenced rather than filled in.
    const childrenOf = (f) => {
        const cls = f.class || f.orClass;
        if (cls && cls !== CONCEPT && byClass.has(cls)) return { key: `class:${cls}`, map: byClass.get(cls) };
        if (f.node && byShape.has(f.node) && !schemes.has(f.node)) return { key: `shape:${f.node}`, map: byShape.get(f.node) };
        return null;
    };

    const build = (fieldMap, depth, seen) => [...fieldMap.values()].map((f) => {
        const child = childrenOf(f);
        const fields = child && depth < MAX_DEPTH && !seen.has(child.key)
            ? build(child.map, depth + 1, new Set([...seen, child.key]))
            : [];
        const cls = f.class || f.orClass;
        const codeList = schemes.get(f.node) || null;
        const isIri = cls || codeList || [`${SH}IRI`, `${SH}BlankNodeOrIRI`].includes(f.nodeKind);
        return {
            path: f.path,
            curie: f.curie,
            label: f.name || nameOf.get(f.path) || humanize(f.path),
            description: f.description,
            order: f.order,
            status: f.status,
            min: f.min,
            max: f.max,
            kind: fields.length > 0 ? 'node' : (isIri ? 'iri' : 'literal'),
            datatype: f.datatype ? curie(f.datatype) : null,
            datatypeIri: f.datatype || null,
            class: cls ? curie(cls) : null,
            classIri: cls || null,
            codeList,
            in: f.in,
            unsupported: f.complex ? 'Uses sh:or, sh:and, sh:xone or sh:not, which this simulator does not read' : null,
            fields,
        };
    }).sort(order);

    const root = byClass.get(DATASET);
    const fields = root ? build(root, 1, new Set([`class:${DATASET}`])) : [];
    return {
        profileId,
        root: curie(DATASET),
        fields,
        dataStandard: dataStandardField(fields, dataStandardPath),
        unsupported: {
            complexConstraints: rows.filter((r) => val(r, 'complex') === '1').length,
            nonIriPaths,
        },
    };
}

// ---------------------------------------------------------------------------
// The catalog model a dataspace uses
// ---------------------------------------------------------------------------

// Without a hub, or before one is chosen, a dataspace falls back to the profile
// the default scenario ships, loaded once into graphs of its own.
const DEFAULT_PROFILE = scenarios.getScenario(scenarios.DEFAULT_SCENARIO_ID).catalogProfiles[0];
const defaultGraph = (i) => `urn:graph:catalog-profile:default:${i}`;
let defaultLoaded = null;

function loadDefaultProfile() {
    defaultLoaded ||= Promise.all(DEFAULT_PROFILE.files.map((rel, i) => replaceGraph(
        defaultGraph(i),
        fs.readFileSync(scenarios.scenarioFile(rel), 'utf8'),
        MEDIA_TYPES[path.extname(rel).toLowerCase()],
    ))).catch((err) => {
        defaultLoaded = null;
        throw err;
    });
    return defaultLoaded;
}

async function catalogModel(dataspaceId, hubOn) {
    const chosen = hubOn ? db.getDataspaceSettings(dataspaceId).catalog?.profileId : null;
    const model = chosen ? await fieldModel(dataspaceId, chosen) : null;
    if (model) return { ...model, source: 'hub' };

    await loadDefaultProfile();
    const graphs = DEFAULT_PROFILE.files.map((_, i) => defaultGraph(i));
    const fallback = await cachedModel('\ndefault', () => modelFromGraphs(DEFAULT_PROFILE.profileId, graphs, DEFAULT_PROFILE.dataStandardPath));
    return { ...fallback, title: DEFAULT_PROFILE.title, source: 'default' };
}

// The graphs of that same profile, chosen by the same rule: its shapes, and the
// vocabularies its entries draw on.
async function catalogShapes(dataspaceId, hubOn) {
    const chosen = hubOn ? db.getDataspaceSettings(dataspaceId).catalog?.profileId : null;
    const artifacts = chosen ? artifactsOf(dataspaceId, chosen) : [];
    const graphsOf = (role) => artifacts.filter((a) => a.role === role).map((a) => artifactGraph(dataspaceId, a.artifact_id));
    if (graphsOf('validation').length > 0) return { profileId: chosen, graphs: graphsOf('validation'), vocabularies: graphsOf('vocabulary') };

    await loadDefaultProfile();
    return { profileId: DEFAULT_PROFILE.profileId, graphs: DEFAULT_PROFILE.files.map((_, i) => defaultGraph(i)), vocabularies: [] };
}

function fieldAt(fields, path) {
    const [head, ...rest] = path;
    const field = fields.find((f) => f.path === head);
    if (!field) return null;
    if (rest.length === 0) return field.kind === 'node' ? null : [field.label];
    const below = fieldAt(field.fields, rest);
    return below && [field.label, ...below];
}

// Where an entry names the data standard it follows: the path the profile was
// given, or dct:conformsTo, which every DCAT-AP profile inherits.
function dataStandardField(fields, chosenPath) {
    const chosenLabels = Array.isArray(chosenPath) && chosenPath.length > 0 ? fieldAt(fields, chosenPath) : null;
    if (chosenLabels) return { path: chosenPath, label: chosenLabels.join(' \u203a '), chosen: true };
    const labels = fieldAt(fields, [P.conformsTo]);
    return labels ? { path: [P.conformsTo], label: labels.join(' \u203a '), chosen: false } : null;
}

async function setDataStandard(dataspaceId, profileId, dataStandardPath) {
    if (!db.getHubProfile(dataspaceId, profileId)) return null;
    const model = await fieldModel(dataspaceId, profileId);
    if (!model) return null;
    if (dataStandardPath !== null && !(Array.isArray(dataStandardPath) && fieldAt(model.fields, dataStandardPath))) {
        throw new ProfileError('dataStandardPath must be null or the path of a field this profile defines');
    }
    db.setHubProfileDataStandard(dataspaceId, profileId, dataStandardPath);
    forgetModels(dataspaceId);
    return { dataStandard: dataStandardField(model.fields, dataStandardPath) };
}

// Counts per field how many entries fill it, so a field the catalog has not
// caught up with shows as such.
function withCoverage(fields, records) {
    const annotate = (level, perEntry) => level.map((f) => {
        const values = perEntry.map((maps) => maps.flatMap((m) => m[f.path] || []));
        return {
            ...f,
            filled: values.filter((v) => v.length > 0).length,
            fields: annotate(f.fields, values.map((v) => v.filter((x) => x.fields).map((x) => x.fields))),
        };
    });
    return annotate(fields, records.map((r) => [r]));
}

module.exports = {
    ProfileError,
    uploadsGraph,
    addProfile,
    removeProfile,
    installScenarioProfiles,
    listFileProfiles,
    fieldModel,
    forgetModels,
    catalogModel,
    catalogShapes,
    setDataStandard,
    withCoverage,
    artifact: (dataspaceId, artifactId) => db.getHubArtifact(dataspaceId, artifactId),
};
