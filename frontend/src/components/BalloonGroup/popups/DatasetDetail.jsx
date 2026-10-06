import React, { useContext, useState } from 'react';
import { AlertTriangle, ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react';
import { OpenHubProfileContext } from '../../VocabularyHubContext';
import { BASIC_PATHS, flattenFields, shortIri, valuesAt } from '../../catalogFields';

const API_BASE = '/api';

const labelStyle = { fontSize: '0.64rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const valueStyle = { fontSize: '0.72rem', color: 'var(--text-primary)', wordBreak: 'break-word' };
const sectionStyle = { fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-secondary)', margin: '10px 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' };
const uriStyle = { fontSize: '0.66rem', color: 'var(--color-primary)', fontFamily: 'monospace', wordBreak: 'break-all' };

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

const FieldValues = ({ field }) => {
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
                            <div style={uriStyle}>{resource.artifact}</div>
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

// Optional fields stay folded away, so a profile with a hundred of them does not bury the rest.
const DatasetDetail = ({ dataset, dataspaceId, model }) => {
    const [showOptional, setShowOptional] = useState(false);
    if (!dataset) return null;

    const standard = model?.dataStandard;
    const standardKey = standard?.path.join(' ');
    const entries = model
        ? flattenFields(model.fields)
            .filter((f) => !BASIC_PATHS.includes(f.path[0]) && f.key !== standardKey)
            .map((f) => ({ ...f, values: valuesAt(dataset.record, f.path) }))
            .filter((f) => f.values.length > 0)
        : [];
    const shown = entries.filter((f) => f.status !== 'optional');
    const optional = entries.filter((f) => f.status === 'optional');
    const schemas = standard ? valuesAt(dataset.record, standard.path).map((v) => v.iri || v.value) : [];

    const publisher = dataset.publisherName || dataset.ownerName || dataset.publisherBpn;
    const policy = dataset.policyName || dataset.policyId;
    const Chevron = showOptional ? ChevronDown : ChevronRight;

    return (
        <div>
            {dataset.description && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px' }}>{dataset.description}</div>
            )}

            {entries.length > 0 && (
                <Section title="Metadata">
                    {shown.map((f) => <Field key={f.key} label={f.label}><FieldValues field={f} /></Field>)}
                    {optional.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowOptional(!showOptional)}
                            style={{ padding: 0, marginBottom: '6px', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.66rem', color: 'var(--color-primary)' }}
                        >
                            <Chevron size={11} />
                            {showOptional ? 'Fewer fields' : `${optional.length} optional field${optional.length === 1 ? '' : 's'}`}
                        </button>
                    )}
                    {showOptional && optional.map((f) => <Field key={f.key} label={f.label}><FieldValues field={f} /></Field>)}
                </Section>
            )}

            {standard && (
                <Section title="Data standard">
                    <Field label={standard.label}>
                        {schemas.length > 0
                            ? schemas.map((uri) => <SchemaLink key={uri} uri={uri} dataspaceId={dataspaceId} />)
                            : <div style={{ ...noteStyle, color: '#d97706' }}><AlertTriangle size={11} /> None declared</div>}
                    </Field>
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
