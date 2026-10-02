import React, { useContext, useState } from 'react';
import { AlertTriangle, ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react';
import { OpenHubProfileContext } from '../../VocabularyHubContext';

const API_BASE = '/api';

// dct:conformsTo is labelled "Reference system" because that is what
// mobilityDCAT-AP means by it. The profile a payload follows lives on the
// distribution's data standard instead.
const CORE_FIELDS = [
    ['dct:creator', 'Creator'],
    ['dcat:keyword', 'Keywords'],
    ['dcat:theme', 'Themes'],
    ['dct:spatial', 'Region'],
    ['dct:temporal', 'Period'],
    ['dct:language', 'Language'],
    ['dct:license', 'License'],
    ['dct:format', 'Format'],
    ['dct:accrualPeriodicity', 'Update frequency'],
    ['dct:conformsTo', 'Reference system'],
    ['dct:relation', 'Related'],
    ['dcat:landingPage', 'Landing page'],
    ['dcat:contactPoint', 'Contact'],
];

const MOBILITY_FIELDS = [
    ['mobilitydcatap:mobilityTheme', 'Mobility theme'],
    ['mobilitydcatap:transportMode', 'Transport mode'],
    ['mobilitydcatap:networkCoverage', 'Network coverage'],
    ['mobilitydcatap:georeferencingMethod', 'Georeferencing'],
    ['mobilitydcatap:intendedInformationService', 'Information service'],
];

const asList = (value) => {
    if (value === undefined || value === null || value === '') return [];
    return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
};

// A dataset reaches this view either from Fuseki via semantic search, which
// returns predicate keys, or from /api/catalog, which returns the form the
// publish dialog stored.
const normalizeDataset = (raw) => {
    if (!raw) return null;

    const fields = {};
    const add = (key, value) => {
        const values = asList(value);
        if (values.length > 0) fields[key] = [...(fields[key] || []), ...values];
    };

    if (raw.dcat) {
        for (const [key, value] of Object.entries(raw.dcat)) add(key, value);
    }

    const stored = raw.dcatFields;
    if (stored) {
        add('dcat:keyword', stored.keywords);
        add('dcat:theme', stored.themes);
        add('dct:spatial', stored.spatial);
        add('dct:temporal', stored.temporalCoverage);
        for (const entry of stored.additionalDcat || []) add(entry?.key, entry?.value);
    }

    return {
        title: raw.title || raw.name || raw.datasetId || raw.id || 'Untitled',
        description: raw.description || '',
        publisher: raw.publisherName || raw.ownerName || raw.publisherBpn || '',
        policyName: raw.policyName || raw.policyId || '',
        publishedAt: raw.publishedAt || '',
        fields,
        distributions: raw.distributions || stored?.distributions || [],
    };
};

const labelStyle = { fontSize: '0.64rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const valueStyle = { fontSize: '0.72rem', color: 'var(--text-primary)', wordBreak: 'break-word' };
const sectionStyle = { fontSize: '0.66rem', fontWeight: 700, color: 'var(--text-secondary)', margin: '10px 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' };
const uriStyle = { fontSize: '0.66rem', color: 'var(--color-primary)', fontFamily: 'monospace', wordBreak: 'break-all' };

const Field = ({ label, values }) => (
    <div style={{ marginBottom: '6px' }}>
        <div style={labelStyle}>{label}</div>
        <div style={valueStyle}>{values.join(', ')}</div>
    </div>
);

const Section = ({ title, children }) => (
    <>
        <div style={sectionStyle}>{title}</div>
        {children}
    </>
);

const renderFields = (fields, definitions) => definitions
    .filter(([key]) => (fields[key] || []).length > 0)
    .map(([key, label]) => <Field key={key} label={label} values={fields[key]} />);

const noteStyle = { fontSize: '0.66rem', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' };

// mobilitydcatap:schema is where the spec asks a portal to point at its schema
// registry, so this is the one place the catalogue meets the Vocabulary Hub.
const SchemaLink = ({ uri, dataspaceId }) => {
    const openHubProfile = useContext(OpenHubProfileContext);
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState('idle');
    const [profile, setProfile] = useState(null);

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

const DataStandard = ({ standard, dataspaceId }) => (
    <div style={{ marginTop: '6px', paddingLeft: '8px', borderLeft: '2px solid var(--color-primary)' }}>
        <div style={labelStyle}>Data standard</div>
        <div style={{ ...valueStyle, fontWeight: 600 }}>
            {standard.label || 'Unnamed'}{standard.version ? ` ${standard.version}` : ''}
        </div>
        {standard.conformsTo && <div style={uriStyle}>{standard.conformsTo}</div>}
        {asList(standard.schema).length > 0 && (
            <div style={{ marginTop: '4px' }}>
                <div style={labelStyle}>Schema</div>
                {asList(standard.schema).map((uri) => (
                    <SchemaLink key={uri} uri={uri} dataspaceId={dataspaceId} />
                ))}
            </div>
        )}
    </div>
);

const Distribution = ({ distribution, dataspaceId }) => {
    const format = distribution.format || distribution.mediaType;
    return (
        <div style={{ padding: '8px', marginBottom: '6px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                <div style={{ ...valueStyle, fontWeight: 600 }}>{distribution.title || 'Distribution'}</div>
                {format && <span style={{ padding: '1px 5px', borderRadius: '4px', fontSize: '0.58rem', background: 'rgba(59,130,246,0.2)', color: '#93c5fd', whiteSpace: 'nowrap' }}>{format}</span>}
            </div>
            {distribution.accessUrl && <div style={uriStyle}>{distribution.accessUrl}</div>}
            {distribution.dataStandard ? (
                <DataStandard standard={distribution.dataStandard} dataspaceId={dataspaceId} />
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: '0.66rem', color: '#d97706' }}>
                    <AlertTriangle size={11} /> No data standard declared
                </div>
            )}
        </div>
    );
};

const DatasetDetail = ({ dataset, dataspaceId }) => {
    const data = normalizeDataset(dataset);
    if (!data) return null;

    const core = renderFields(data.fields, CORE_FIELDS);
    const mobility = renderFields(data.fields, MOBILITY_FIELDS);

    return (
        <div>
            {data.description && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px' }}>{data.description}</div>
            )}

            {core.length > 0 && <Section title="Metadata">{core}</Section>}
            {mobility.length > 0 && <Section title="Mobility">{mobility}</Section>}

            <Section title={`Distributions (${data.distributions.length})`}>
                {data.distributions.length === 0
                    ? <div style={{ fontSize: '0.7rem', color: '#64748b' }}>None declared</div>
                    : data.distributions.map((distribution, i) => (
                        <Distribution key={distribution.accessUrl || i} distribution={distribution} dataspaceId={dataspaceId} />
                    ))}
            </Section>

            <Section title="Access">
                {data.publisher && <Field label="Publisher" values={[data.publisher]} />}
                {data.policyName && <Field label="Policy" values={[data.policyName]} />}
                {data.publishedAt && <Field label="Published" values={[data.publishedAt.substring(0, 10)]} />}
            </Section>
        </div>
    );
};

export default DatasetDetail;
