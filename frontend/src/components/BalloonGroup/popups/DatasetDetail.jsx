import React from 'react';
import { AlertTriangle } from 'lucide-react';

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

const DataStandard = ({ standard }) => (
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
                    <div key={uri} data-schema-uri={uri} style={uriStyle}>{uri}</div>
                ))}
            </div>
        )}
    </div>
);

const Distribution = ({ distribution }) => {
    const format = distribution.format || distribution.mediaType;
    return (
        <div style={{ padding: '8px', marginBottom: '6px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                <div style={{ ...valueStyle, fontWeight: 600 }}>{distribution.title || 'Distribution'}</div>
                {format && <span style={{ padding: '1px 5px', borderRadius: '4px', fontSize: '0.58rem', background: 'rgba(59,130,246,0.2)', color: '#93c5fd', whiteSpace: 'nowrap' }}>{format}</span>}
            </div>
            {distribution.accessUrl && <div style={uriStyle}>{distribution.accessUrl}</div>}
            {distribution.dataStandard ? (
                <DataStandard standard={distribution.dataStandard} />
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', fontSize: '0.66rem', color: '#d97706' }}>
                    <AlertTriangle size={11} /> No data standard declared
                </div>
            )}
        </div>
    );
};

const DatasetDetail = ({ dataset }) => {
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
                        <Distribution key={distribution.accessUrl || i} distribution={distribution} />
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
