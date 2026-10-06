/**
 * validator.js — checks a dataspace's catalog against its catalog profile.
 *
 * The checking is done by Semantic Treehouse's SHACL validator (json-ld-validator),
 * which runs as a container of its own. This module sends it the entries exactly
 * as they are stored, with the shapes of the profile the catalog uses, and maps
 * each result back to the entry and field it concerns.
 */

const axios = require('axios');
const catalogProfiles = require('./catalogprofiles');
const vocabhub = require('./vocabhub');
const { entryTriples, executeSelect, graphsAsTurtle } = require('./semantic');
const { P, RDF_TYPE } = require('./record');

const VALIDATOR_URL = process.env.VALIDATOR_URL || 'http://sim-validator:8000';
const SH = 'http://www.w3.org/ns/shacl#';
const SEVERITIES = { [`${SH}Violation`]: 'violation', [`${SH}Warning`]: 'warning', [`${SH}Info`]: 'info' };

const ntString = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');

function ntTerm(term) {
    if (term.type === 'uri') return `<${term.value}>`;
    if (term.type === 'bnode') return `_:${term.value}`;
    const text = `"${ntString(term.value)}"`;
    if (term['xml:lang']) return `${text}@${term['xml:lang']}`;
    return term.datatype ? `${text}^^<${term.datatype}>` : text;
}

// For each dataset, the properties that lead from it to every node it reaches.
function pathsFromDatasets(rows) {
    const edges = new Map();
    for (const { id, s, p, o } of rows) {
        if (o.type !== 'uri') continue;
        if (!edges.has(id.value)) edges.set(id.value, []);
        edges.get(id.value).push([s.value, p.value, o.value]);
    }
    const paths = new Map();
    for (const { id, ds } of rows) {
        if (paths.has(id.value)) continue;
        const reached = new Map([[ds.value, []]]);
        for (let grew = true; grew;) {
            grew = false;
            for (const [s, p, o] of edges.get(id.value) || []) {
                if (reached.has(s) && !reached.has(o)) {
                    reached.set(o, [...reached.get(s), p]);
                    grew = true;
                }
            }
        }
        paths.set(id.value, reached);
    }
    return paths;
}

const one = (node, key) => node[key]?.[0];

// The classes the profile's shapes expect as values of each property.
async function rangeClasses(graphs) {
    const rows = await executeSelect(`
SELECT DISTINCT ?path ?class ${graphs.map((g) => `FROM <${g}>`).join(' ')}
WHERE { ?shape <${SH}path> ?path ; <${SH}class> ?class . FILTER(isIRI(?path)) }`);
    const ranges = new Map();
    for (const r of rows) {
        if (!ranges.has(r.path.value)) ranges.set(r.path.value, new Set());
        ranges.get(r.path.value).add(r.class.value);
    }
    return ranges;
}

function parseReport(report) {
    const nodes = Array.isArray(report) ? report : report['@graph'] || [];
    return nodes
        .filter((n) => (n['@type'] || []).includes(`${SH}ValidationResult`))
        .map((n) => {
            const path = one(n, `${SH}resultPath`)?.['@id'];
            const value = one(n, `${SH}value`);
            return {
                focus: one(n, `${SH}focusNode`)?.['@id'],
                // A blank node here is a complex path, which the simulator does not read.
                property: path && !path.startsWith('_:') ? path : null,
                severity: SEVERITIES[one(n, `${SH}resultSeverity`)?.['@id']] || 'violation',
                message: one(n, `${SH}resultMessage`)?.['@value'] || '',
                value: value ? (value['@id'] ?? value['@value']) : null,
            };
        });
}

async function validateCatalog(dataspaceId, hubOn) {
    const shapes = await catalogProfiles.catalogShapes(dataspaceId, hubOn);
    const [shapesTurtle, vocabularyTurtle, rows] = await Promise.all([
        graphsAsTurtle(shapes.graphs),
        shapes.vocabularies.length > 0 ? graphsAsTurtle(shapes.vocabularies) : '',
        entryTriples(dataspaceId),
    ]);

    const titles = new Map();
    for (const { id, ds, s, p, o } of rows) {
        if (s.value === ds.value && p.value === P.title) titles.set(id.value, o.value);
        if (!titles.has(id.value)) titles.set(id.value, '');
    }

    let results = [];
    if (titles.size > 0) {
        const triples = [...new Set(rows.map(({ s, p, o }) => `${ntTerm(s)} <${p.value}> ${ntTerm(o)} .`))];
        const described = new Set(rows.map(({ s }) => s.value));
        const referencedBy = new Map();
        for (const { p, o } of rows) {
            if (o.type !== 'uri' || described.has(o.value)) continue;
            if (!referencedBy.has(o.value)) referencedBy.set(o.value, new Set());
            referencedBy.get(o.value).add(p.value);
        }
        // The hub also calls its profiles datasets; only the class expected at the referring property is wanted.
        const ranges = await rangeClasses(shapes.graphs);
        const known = hubOn
            ? (await vocabhub.typesOf(dataspaceId, [...referencedBy.keys()]))
                .filter(([s, type]) => [...referencedBy.get(s)].some((p) => ranges.get(p)?.has(type)))
            : [];
        // Reference data goes in the data graph: the validator's ontology graph only takes class and property definitions.
        const data = [...triples, ...known.map(([s, type]) => `<${s}> <${RDF_TYPE}> <${type}> .`), vocabularyTurtle].join('\n');
        const response = await axios.post(`${VALIDATOR_URL}/validate`, {
            data_graph: { format: 'auto', data },
            shacl_graph: { format: 'auto', data: shapesTurtle },
        }, { headers: { Accept: 'application/ld+json' }, timeout: 120000 });
        results = parseReport(response.data);
    }

    const paths = pathsFromDatasets(rows);
    const entries = [...titles].map(([datasetId, title]) => {
        const reached = paths.get(datasetId);
        const findings = results
            .filter((r) => reached.has(r.focus))
            .map((r) => ({
                path: r.property ? [...reached.get(r.focus), r.property] : null,
                severity: r.severity,
                message: r.message,
                value: r.value,
            }));
        const status = findings.some((f) => f.severity === 'violation') ? 'violations'
            : findings.length > 0 ? 'warnings' : 'conforms';
        return { datasetId, title, status, findings };
    });

    const count = (status) => entries.filter((e) => e.status === status).length;
    return {
        profileId: shapes.profileId,
        ranAt: new Date().toISOString(),
        total: entries.length,
        conforms: count('conforms'),
        warnings: count('warnings'),
        violations: count('violations'),
        entries,
    };
}

module.exports = { validateCatalog };
