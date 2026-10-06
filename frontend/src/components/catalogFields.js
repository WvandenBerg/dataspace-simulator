// Every field of a catalog profile, nested ones under their parent's label.
// A nested field is only as required as the weakest field above it.
export const STATUSES = ['mandatory', 'recommended', 'optional'];

export const flattenFields = (fields, prefix = [], labels = [], weakest = 0) => fields.flatMap((f) => {
    const path = [...prefix, f.path];
    const label = [...labels, f.label];
    const rank = Math.max(weakest, STATUSES.indexOf(f.status));
    const own = f.kind === 'node' ? [] : [{ ...f, key: path.join(' '), path, label: label.join(' \u203a '), status: STATUSES[rank] }];
    return [...own, ...flattenFields(f.fields, path, label, rank)];
});

export const shortIri = (iri) => String(iri).split(/[#/]/).filter(Boolean).pop() || iri;

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
