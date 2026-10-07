// The claims the industry and role policies match against.
export const INDUSTRIES = ['construction', 'manufacturing', 'logistics', 'energy', 'automotive'];
export const ORG_ROLES = ['customer', 'contractor', 'supplier', 'manufacturer'];

export function toList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}

// The fixed values plus every value a participant already carries, so a scenario's own values are offered too.
export const credentialOptions = (base, nodes, key) => [...new Set([
    ...base,
    ...nodes.flatMap((n) => toList(n[key] ?? n.metadata?.[key]).map((v) => v.toLowerCase())),
])];
