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
