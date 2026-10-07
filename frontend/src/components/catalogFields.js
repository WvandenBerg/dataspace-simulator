// Every field of a catalog profile, nested ones under their parent's label.
// A nested field is only as required as the weakest field above it, and
// nodeTypes holds the class of each node on its path, for writing them typed.
export const STATUSES = ['mandatory', 'recommended', 'optional'];

export const flattenFields = (fields, prefix = [], labels = [], weakest = 0, nodeTypes = []) => fields.flatMap((f) => {
    const path = [...prefix, f.path];
    const label = [...labels, f.label];
    const rank = Math.max(weakest, STATUSES.indexOf(f.status));
    const own = f.kind === 'node' ? [] : [{ ...f, key: path.join(' '), path, label: label.join(' \u203a '), status: STATUSES[rank], nodeTypes }];
    return [...own, ...flattenFields(f.fields, path, label, rank, [...nodeTypes, f.classIri || null])];
});

export const shortIri = (iri) => String(iri).split(/[#/]/).filter(Boolean).pop() || iri;

// Every field of the profile, nodes included, since a validation finding can concern a node itself.
export const fieldLabels = (fields, prefix = [], labels = [], out = new Map()) => {
    for (const f of fields) {
        const path = [...prefix, f.path];
        const label = [...labels, f.label];
        out.set(path.join(' '), label.join(' \u203a '));
        fieldLabels(f.fields || [], path, label, out);
    }
    return out;
};

export const findingLabel = (labels, path) => (path.length > 0
    ? labels.get(path.join(' ')) || path.map(shortIri).join(' \u203a ')
    : 'The entry as a whole');

// Title, description and publisher have their own place in every view, so the profile's copies are skipped.
export const BASIC_PATHS = [
    'http://purl.org/dc/terms/title',
    'http://purl.org/dc/terms/description',
    'http://purl.org/dc/terms/publisher',
];

// The IRIs and literals found by following a path of properties down through nested nodes.
export const valuesAt = (record, path) => {
    let nodes = [record || {}];
    for (const p of path.slice(0, -1)) {
        nodes = nodes.flatMap((n) => (n[p] || []).filter((v) => v.fields).map((v) => v.fields));
    }
    return nodes.flatMap((n) => n[path[path.length - 1]] || []).filter((v) => v.iri || v.value);
};
