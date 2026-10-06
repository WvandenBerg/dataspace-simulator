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
const { entryTriples, graphsAsTurtle } = require('./semantic');
const { P } = require('./record');

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
    const [shapesTurtle, rows] = await Promise.all([
        graphsAsTurtle(shapes.graphs),
        entryTriples(dataspaceId),
    ]);

    const titles = new Map();
    for (const { id, ds, s, p, o } of rows) {
        if (s.value === ds.value && p.value === P.title) titles.set(id.value, o.value);
        if (!titles.has(id.value)) titles.set(id.value, '');
    }

    let results = [];
    if (titles.size > 0) {
        const data = [...new Set(rows.map(({ s, p, o }) => `${ntTerm(s)} <${p.value}> ${ntTerm(o)} .`))].join('\n');
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
