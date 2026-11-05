import React, { useContext, useState } from 'react';
import { AlertTriangle, ArrowUpRight, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { OpenHubProfileContext, ValidationReportContext } from '../../VocabularyHubContext';
import { BASIC_PATHS, fieldLabels, findingLabel, flattenFields, labelWithin, nodesAt, repeatableNodes, shortIri, valuesAt } from '../../catalogFields';

const API_BASE = '/api';

const labelStyle = { fontSize: '0.64rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const valueStyle = { fontSize: '0.72rem', color: 'var(--text-primary)', wordBreak: 'break-word' };
const sectionStyle = { fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-secondary)', margin: '10px 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' };
const uriStyle = { fontSize: '0.66rem', color: 'var(--color-primary)', fontFamily: 'monospace', wordBreak: 'break-all' };
const nodeStyle = { margin: '2px 0 8px', paddingLeft: '8px', borderLeft: '2px solid var(--border-subtle)' };
const nodeTitleStyle = { ...labelStyle, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' };

const Field = ({ label, children }) => (
    <div style={{ marginBottom: '6px' }}>
        <div style={labelStyle}>{label}</div>
        {children}
    </div>
);

const Section = ({ title, children }) => (
    <>
        <div style={sectionStyle}>{title}</div>
        {children}
    </>
);

const FieldValues = ({ field, dataspaceId }) => {
    if (field.isStandard) {
        return field.values.map((v) => <SchemaLink key={v.iri || v.value} uri={v.iri || v.value} dataspaceId={dataspaceId} />);
    }
    const literals = field.values.filter((v) => !v.iri).map((v) => v.value);
    const iris = field.values.filter((v) => v.iri).map((v) => v.iri);
    return (
        <>
            {literals.length > 0 && <div style={valueStyle}>{literals.join(', ')}</div>}
            {iris.map((iri) => (field.in || field.codeList
                ? <div key={iri} style={valueStyle} title={iri}>{shortIri(iri)}</div>
                : <div key={iri} style={uriStyle}>{iri}</div>))}
        </>
    );
};

const noteStyle = { fontSize: '0.66rem', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' };

// The profile's data-standard field is where an entry points at a schema
// registry, so this is the one place the catalogue meets the Vocabulary Hub.
const SchemaLink = ({ uri, dataspaceId }) => {
    const openHubProfile = useContext(OpenHubProfileContext);
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState('idle');
    const [profile, setProfile] = useState(null);

    if (!openHubProfile) return <div style={{ ...uriStyle, marginBottom: '3px' }}>{uri}</div>;

    const toggle = async () => {
        if (open) return setOpen(false);
        setOpen(true);
        if (status !== 'idle') return;

        setStatus('loading');
        try {
            const response = await fetch(`${API_BASE}/vocabhub/profiles/${encodeURIComponent(uri)}?dataspaceId=${encodeURIComponent(dataspaceId)}`);
            if (response.status === 404) return setStatus('missing');
            if (!response.ok) throw new Error(response.status);
            setProfile(await response.json());
            setStatus('found');
        } catch {
            setStatus('unavailable');
        }
    };

    const Chevron = open ? ChevronDown : ChevronRight;

    return (
        <div style={{ marginBottom: '3px' }}>
            <div
                onClick={toggle}
                style={{ ...uriStyle, cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '3px' }}
            >
                <Chevron size={11} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>{uri}</span>
                {/^https?:\/\//i.test(uri) && (
                    <a
                        href={uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open ${uri}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: 'inherit', flexShrink: 0, marginTop: '1px', display: 'inline-flex' }}
                    >
                        <ExternalLink size={11} />
                    </a>
                )}
            </div>

            {open && status === 'loading' && <div style={{ ...labelStyle, marginLeft: '14px' }}>Asking the Vocabulary Hub...</div>}

            {open && (status === 'missing' || status === 'unavailable') && (
                <div style={{ ...noteStyle, color: '#d97706', marginLeft: '14px' }}>
                    <AlertTriangle size={11} />
                    {status === 'missing' ? 'Not in the Vocabulary Hub' : 'Vocabulary Hub unavailable'}
                </div>
            )}

            {open && status === 'found' && profile && (
                <div style={{ marginLeft: '14px', marginTop: '4px', padding: '6px 8px', background: 'rgba(22, 163, 74, 0.06)', border: '1px solid rgba(22, 163, 74, 0.35)', borderRadius: '4px' }}>
                    {/* Styled after the hub itself, so it reads as the hub answering rather than more asset metadata. */}
                    <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px', color: '#15803d' }}>
                        <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#14532d', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <img src="/assets/sth-logo.svg" alt="" style={{ width: '9px', height: '9px' }} />
                        </span>
                        From the Vocabulary Hub
                    </div>
                    <div style={{ ...valueStyle, fontWeight: 600 }}>{profile.title}</div>
                    {profile.publisher && <div style={labelStyle}>{profile.publisher}</div>}
                    {profile.description && <div style={{ ...valueStyle, marginTop: '4px' }}>{profile.description}</div>}
                    {(profile.resources || []).map((resource) => (
                        <div key={resource.roleIri + resource.artifact} style={{ marginTop: '4px' }}>
                            <div style={labelStyle}>{resource.role}</div>
                            {/^https?:\/\//i.test(resource.artifact)
                                ? <a href={resource.artifact} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ ...uriStyle, display: 'block', textDecoration: 'underline' }}>{resource.artifact}</a>
                                : <div style={uriStyle}>{resource.artifact}</div>}
                        </div>
                    ))}
                    {openHubProfile && (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openHubProfile(uri); }}
                            style={{ marginTop: '6px', padding: 0, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.68rem', fontWeight: 600, color: '#15803d' }}
                        >
                            Open in Vocabulary Hub <ArrowUpRight size={11} />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

const SEVERITY_COLORS = { violation: '#dc2626', warning: '#d97706', info: '#64748b' };
const SEVERITY_RANK = { violation: 0, warning: 1, info: 2 };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// How the entry fared in the metadata validator's latest run, if it runs.
const ValidationBadge = ({ datasetId, model }) => {
    const report = useContext(ValidationReportContext);
    const [open, setOpen] = useState(false);
    const entry = report?.entries.find((e) => e.datasetId === datasetId);
    if (!entry) return null;

    const count = (s) => entry.findings.filter((f) => f.severity === s).length;
    const violations = count('violation');
    const warnings = count('warning');
    const color = violations > 0 ? SEVERITY_COLORS.violation : warnings > 0 ? SEVERITY_COLORS.warning : '#16a34a';
    const text = violations > 0
        ? [plural(violations, 'violation'), warnings > 0 && plural(warnings, 'warning')].filter(Boolean).join(', ')
        : warnings > 0 ? `No violations, ${plural(warnings, 'warning')}` : 'Passes validation';
    const labels = model ? fieldLabels(model.fields) : new Map();
    const Chevron = open ? ChevronDown : ChevronRight;

    return (
        <div style={{ marginBottom: '8px' }}>
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
                disabled={entry.findings.length === 0}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 8px', borderRadius: '999px', border: `1px solid ${color}`, background: 'transparent', color, fontSize: '0.66rem', fontWeight: 600, cursor: entry.findings.length > 0 ? 'pointer' : 'default' }}
            >
                {entry.findings.length > 0 && <Chevron size={11} />}
                {text}
            </button>
            {open && (
                // Framed like the hub's answer below, so it reads as the validator speaking rather than more metadata.
                <div style={{ marginTop: '6px', padding: '6px 8px', background: `${color}0f`, border: `1px solid ${color}59`, borderLeft: `3px solid ${color}`, borderRadius: '4px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div style={{ ...labelStyle, color }}>From the Metadata Validator</div>
                    {[...entry.findings]
                        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
                        .map((f, i) => (
                            <div key={i} style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: SEVERITY_COLORS[f.severity], flexShrink: 0 }} />
                                <div style={{ minWidth: 0 }}>
                                    {f.path.length > 0 && <div style={{ ...valueStyle, fontWeight: 600 }}>{findingLabel(labels, f.path)}</div>}
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{f.message}</div>
                                </div>
                            </div>
                        ))}
                </div>
            )}
        </div>
    );
};

// Optional fields stay folded away, so a profile with a hundred of them does not bury the rest.
const DatasetDetail = ({ dataset, dataspaceId, model }) => {
    const [showOptional, setShowOptional] = useState(false);
    if (!dataset) return null;

    const standardKey = model?.dataStandard?.path.join(' ');
    const groups = model ? repeatableNodes(model.fields) : [];
    const fields = model
        ? flattenFields(model.fields)
            .filter((f) => !BASIC_PATHS.includes(f.path[0]))
            .map((f) => ({ ...f, isStandard: f.key === standardKey }))
        : [];
    const filled = (fs, record) => fs
        .map((f) => ({ ...f, values: valuesAt(record, f.path) }))
        .filter((f) => f.values.length > 0);

    const entries = filled(fields.filter((f) => !groups.some((g) => g.path === f.path[0])), dataset.record);
    const nodes = groups.flatMap((g) => {
        const found = nodesAt(dataset.record, g.path);
        return found.map((node, i) => ({
            key: `${g.path} ${i}`,
            title: found.length > 1 ? `${g.label} ${i + 1}` : g.label,
            entries: filled(fields.filter((f) => f.path[0] === g.path), { [g.path]: [node] })
                .map((f) => ({ ...f, label: labelWithin(g, f) })),
        }));
    }).filter((n) => n.entries.length > 0);

    const shown = entries.filter((f) => f.status !== 'optional');
    const optional = entries.filter((f) => f.status === 'optional');
    const optionalCount = optional.length + nodes.reduce((n, node) => n + node.entries.filter((f) => f.status === 'optional').length, 0);

    const publisher = dataset.publisherName || dataset.ownerName || dataset.publisherBpn;
    const policy = dataset.policyName || dataset.policyId;
    const Chevron = showOptional ? ChevronDown : ChevronRight;
    const fieldsOf = (fs) => fs.map((f) => <Field key={f.key} label={f.label}><FieldValues field={f} dataspaceId={dataspaceId} /></Field>);

    return (
        <div>
            <ValidationBadge datasetId={dataset.datasetId || dataset.id || dataset['@id']} model={model} />

            {dataset.description && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px' }}>{dataset.description}</div>
            )}

            {(entries.length > 0 || nodes.length > 0) && (
                <Section title="Metadata">
                    {fieldsOf(shown)}
                    {nodes.map((node) => {
                        const visible = node.entries.filter((f) => showOptional || f.status !== 'optional');
                        return visible.length > 0 && (
                            <div key={node.key} style={nodeStyle}>
                                <div style={nodeTitleStyle}>{node.title}</div>
                                {fieldsOf(visible)}
                            </div>
                        );
                    })}
                    {optionalCount > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowOptional(!showOptional)}
                            style={{ padding: 0, marginBottom: '6px', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.66rem', color: 'var(--color-primary)' }}
                        >
                            <Chevron size={11} />
                            {showOptional ? 'Fewer fields' : `${optionalCount} optional field${optionalCount === 1 ? '' : 's'}`}
                        </button>
                    )}
                    {showOptional && fieldsOf(optional)}
                </Section>
            )}

            <Section title="Access">
                {publisher && <Field label="Publisher"><div style={valueStyle}>{publisher}</div></Field>}
                {policy && <Field label="Policy"><div style={valueStyle}>{policy}</div></Field>}
                {dataset.publishedAt && <Field label="Published"><div style={valueStyle}>{dataset.publishedAt.substring(0, 10)}</div></Field>}
            </Section>
        </div>
    );
};

export default DatasetDetail;
