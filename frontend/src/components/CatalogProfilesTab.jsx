import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Download, FileText, Info, Trash2, Upload } from 'lucide-react';

const API_BASE = '/api';
const ACCEPT = '.ttl,.n3,.nt,.jsonld,.json,.rdf,.owl,.xml';
const DATA_STANDARD_HELP = 'The field in which a catalog entry following this profile names the data standard '
    + 'its data follows. When the catalog uses this profile, the data-standard filter in the semantic search '
    + 'looks here, and so does widening a search along the Vocabulary Hub\'s alignments. Automatic uses '
    + 'dct:conformsTo, which every DCAT-AP profile inherits; choose another if the profile names the standard elsewhere.';

const labelStyle = { fontSize: '0.64rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const uriStyle = { fontSize: '0.66rem', color: 'var(--color-primary)', fontFamily: 'monospace', wordBreak: 'break-all' };
const inputStyle = { flex: 1, minWidth: 0, padding: '6px 8px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.76rem' };
const warnStyle = { display: 'flex', alignItems: 'flex-start', gap: '5px', fontSize: '0.7rem', color: '#b45309' };

const STATUS_COLORS = { mandatory: '#dc2626', recommended: '#d97706', optional: '#94a3b8' };

const StatusDot = ({ status }) => (
    <span title={status} style={{ width: '7px', height: '7px', borderRadius: '50%', background: STATUS_COLORS[status], flexShrink: 0, marginTop: '5px' }} />
);

// A child's status holds within its parent only, so hiding an optional field hides its branch.
const FieldRow = ({ field, depth, showOptional }) => {
    if (!showOptional && field.status === 'optional') return null;
    return (
        <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '2px 0', paddingLeft: `${depth * 14}px` }}>
                <StatusDot status={field.status} />
                <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)' }}>{field.label}</span>
                    <span style={{ ...uriStyle, marginLeft: '6px' }}>{field.curie}</span>
                    <span style={{ ...labelStyle, marginLeft: '6px' }}>{field.min}..{field.max ?? 'n'}</span>
                    {field.codeList && <span title={field.codeList} style={{ ...labelStyle, marginLeft: '6px', color: '#15803d' }}>code list</span>}
                    {field.unsupported && (
                        <span title={field.unsupported} style={{ marginLeft: '6px' }}>
                            <AlertTriangle size={11} color="#d97706" style={{ verticalAlign: '-1px' }} />
                        </span>
                    )}
                </div>
            </div>
            {field.fields.map((child) => (
                <FieldRow key={child.path} field={child} depth={depth + 1} showOptional={showOptional} />
            ))}
        </>
    );
};

const FieldTree = ({ dataspaceId, profileId }) => {
    const [model, setModel] = useState(null);
    const [error, setError] = useState(null);
    const [showOptional, setShowOptional] = useState(false);

    useEffect(() => {
        fetch(`${API_BASE}/vocabhub/profiles/${encodeURIComponent(profileId)}/fields?dataspaceId=${encodeURIComponent(dataspaceId)}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
            .then(setModel)
            .catch(() => setError('Could not read the fields from this profile'));
    }, [dataspaceId, profileId]);

    if (error) return <div style={warnStyle}><AlertTriangle size={11} /> {error}</div>;
    if (!model) return <div style={labelStyle}>Reading shapes...</div>;

    const { complexConstraints, nonIriPaths } = model.unsupported;
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '4px 0 6px' }}>
                <span style={labelStyle}>Fields of a catalog entry ({model.root})</span>
                {['mandatory', 'recommended', 'optional'].map((s) => (
                    <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: STATUS_COLORS[s] }} /> {s}
                    </span>
                ))}
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.66rem', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto' }}>
                    <input type="checkbox" checked={showOptional} onChange={(e) => setShowOptional(e.target.checked)} /> show optional
                </label>
            </div>
            {model.fields.length === 0 && (
                <div style={warnStyle}><AlertTriangle size={11} /> No shape targets dcat:Dataset, so this profile defines no catalog entry fields.</div>
            )}
            {model.fields.map((f) => <FieldRow key={f.path} field={f} depth={0} showOptional={showOptional} />)}
            {(complexConstraints > 0 || nonIriPaths > 0) && (
                <div style={{ ...warnStyle, marginTop: '6px' }}>
                    <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: '1px' }} />
                    {complexConstraints > 0 && `${complexConstraints} constraint(s) use sh:or, sh:and, sh:xone or sh:not, which this simulator does not read. `}
                    {nonIriPaths > 0 && `${nonIriPaths} constraint(s) use a path the simulator can't show as a field (e.g. an inverse path) and are not listed.`}
                </div>
            )}
        </div>
    );
};

// A data standard is identified by IRI, so only fields that hold one can name it.
const standardFields = (fields, prefix = [], labels = []) => fields.flatMap((f) => {
    const path = [...prefix, f.path];
    const label = [...labels, f.label];
    const own = f.kind === 'iri' ? [{ key: path.join(' '), path, label: label.join(' \u203a ') }] : [];
    return [...own, ...standardFields(f.fields, path, label)];
});

const DataStandardField = ({ dataspaceId, profileId }) => {
    const [model, setModel] = useState(null);
    const [error, setError] = useState(null);
    const url = `${API_BASE}/vocabhub/profiles/${encodeURIComponent(profileId)}`;
    const query = `?dataspaceId=${encodeURIComponent(dataspaceId)}`;

    useEffect(() => {
        fetch(`${url}/fields${query}`)
            .then((r) => (r.ok ? r.json() : null))
            .then(setModel)
            .catch(() => setModel(null));
    }, [url, query]);

    if (!model) return null;
    const options = standardFields(model.fields);

    const choose = async (key) => {
        setError(null);
        const res = await fetch(`${url}${query}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataStandardPath: options.find((o) => o.key === key)?.path || null }),
        });
        const data = await res.json();
        if (!res.ok) return setError(data.error || 'Could not save');
        setModel((m) => ({ ...m, dataStandard: data.dataStandard }));
    };

    return (
        <div style={{ margin: '4px 0 8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', color: 'var(--text-primary)' }}>
                Data standard field
                <span title={DATA_STANDARD_HELP} style={{ display: 'inline-flex', cursor: 'help' }}>
                    <Info size={13} color="var(--text-muted)" />
                </span>
                <select
                    value={model.dataStandard?.chosen ? model.dataStandard.path.join(' ') : ''}
                    onChange={(e) => choose(e.target.value)}
                    style={{ ...inputStyle, flex: '0 1 auto', maxWidth: '420px' }}
                >
                    <option value="">Automatic (dct:conformsTo)</option>
                    {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
            </label>
            {!model.dataStandard && (
                <div style={{ ...warnStyle, marginTop: '4px' }}>
                    <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: '1px' }} /> This profile has no dct:conformsTo, so searching by data standard finds nothing until you choose a field.
                </div>
            )}
            {error && <div style={{ ...warnStyle, color: '#dc2626', marginTop: '4px' }}>{error}</div>}
        </div>
    );
};

const ProfileEntry = ({ dataspaceId, profile, inUse, onUse, onDelete }) => {
    const [open, setOpen] = useState(false);
    const Chevron = open ? ChevronDown : ChevronRight;
    const query = `?dataspaceId=${encodeURIComponent(dataspaceId)}`;

    return (
        <div style={{ borderBottom: '1px solid var(--border-color)', padding: '8px 0' }}>
            <div onClick={() => setOpen(!open)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Chevron size={13} color="var(--text-muted)" />
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>{profile.title}</span>
                {profile.version && <span style={labelStyle}>{profile.version}</span>}
                <span style={{ ...labelStyle, marginLeft: 'auto' }}>{profile.source === 'upload' ? 'uploaded' : 'from scenario'}</span>
                {inUse ? (
                    <span style={{ padding: '1px 7px', borderRadius: '999px', fontSize: '0.64rem', fontWeight: 600, color: '#15803d', background: 'rgba(22, 163, 74, 0.12)', border: '1px solid rgba(22, 163, 74, 0.45)' }}>
                        In use
                    </span>
                ) : (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onUse(profile); }}
                        style={{ padding: '1px 7px', borderRadius: '999px', fontSize: '0.64rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border-subtle)' }}
                    >
                        Use for this catalog
                    </button>
                )}
                {profile.source === 'upload' && (
                    <Trash2
                        size={13}
                        color="var(--text-muted)"
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); onDelete(profile); }}
                    />
                )}
            </div>
            {open && (
                <div style={{ marginTop: '6px', paddingLeft: '19px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '8px' }}>
                        {profile.files.map((f) => (
                            <a
                                key={f.artifactId}
                                href={`${API_BASE}/vocabhub/artifacts/${encodeURIComponent(f.artifactId)}${query}`}
                                style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', color: 'var(--text-secondary)', textDecoration: 'none' }}
                            >
                                <FileText size={11} /> {f.name}
                                <span style={labelStyle}>{f.role}</span>
                                <Download size={11} color="var(--color-primary)" />
                            </a>
                        ))}
                    </div>
                    <DataStandardField dataspaceId={dataspaceId} profileId={profile.id} />
                    <FieldTree dataspaceId={dataspaceId} profileId={profile.id} />
                </div>
            )}
        </div>
    );
};

const UploadReport = ({ dataspaceId, report }) => (
    <div style={{ marginTop: '8px', padding: '8px', borderRadius: '6px', background: 'rgba(22, 163, 74, 0.08)', border: '1px solid rgba(22, 163, 74, 0.35)' }}>
        <div style={{ fontSize: '0.76rem', color: '#15803d', fontWeight: 600 }}>
            Loaded: {report.fields} catalog entry field(s)
        </div>
        <DataStandardField dataspaceId={dataspaceId} profileId={report.profileId} />
        {report.files.map((f) => (
            <div key={f.artifactId} style={{ marginTop: '4px' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    {f.name} <span style={labelStyle}>{f.role} · {f.tripleCount} triples · {f.shapes} shapes</span>
                </div>
                {f.unresolvedImports.map((iri) => (
                    <div key={iri} style={warnStyle}>
                        <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: '1px' }} />
                        <span>Imports <span style={uriStyle}>{iri}</span>, which was not uploaded. The hub does not fetch imports, so add that file to this profile if its constraints matter.</span>
                    </div>
                ))}
            </div>
        ))}
    </div>
);

const UploadForm = ({ dataspaceId, onUploaded }) => {
    const [files, setFiles] = useState([]);
    const [title, setTitle] = useState('');
    const [version, setVersion] = useState('');
    const [dragging, setDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const [report, setReport] = useState(null);
    const pickerRef = useRef(null);

    const addFiles = (list) => {
        const incoming = [...list];
        setFiles((prev) => [...prev.filter((p) => !incoming.some((f) => f.name === p.name)), ...incoming]);
        setReport(null);
        setError(null);
    };

    const upload = async () => {
        setUploading(true);
        setError(null);
        try {
            const payload = {
                title,
                version,
                files: await Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() }))),
            };
            const res = await fetch(`${API_BASE}/vocabhub/profiles?dataspaceId=${encodeURIComponent(dataspaceId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            setReport(data);
            setFiles([]);
            setTitle('');
            setVersion('');
            onUploaded();
        } catch (e) {
            setError(e.message);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
            <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                onClick={() => pickerRef.current?.click()}
                style={{ border: `2px dashed ${dragging ? '#16a34a' : 'var(--border-subtle)'}`, borderRadius: '8px', padding: '12px', textAlign: 'center', cursor: 'pointer', background: dragging ? 'rgba(22, 163, 74, 0.06)' : 'transparent' }}
            >
                <input ref={pickerRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                <Upload size={18} color={dragging ? '#16a34a' : 'var(--text-muted)'} />
                <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Drop a DCAT-AP profile's SHACL shapes and vocabulary files, or click to select
                </div>
            </div>

            {files.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                    {files.map((f) => (
                        <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            <FileText size={11} /> {f.name}
                            <span style={labelStyle}>{(f.size / 1024).toFixed(1)} KB</span>
                            <Trash2 size={11} style={{ cursor: 'pointer', marginLeft: 'auto' }} onClick={() => setFiles((prev) => prev.filter((p) => p !== f))} />
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Profile title *" style={inputStyle} />
                        <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version" style={{ ...inputStyle, flex: '0 0 90px' }} />
                        <button
                            type="button"
                            disabled={uploading || !title.trim()}
                            onClick={upload}
                            style={{ padding: '6px 12px', border: 'none', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 600, cursor: uploading || !title.trim() ? 'not-allowed' : 'pointer', background: uploading || !title.trim() ? 'var(--bg-card)' : '#16a34a', color: uploading || !title.trim() ? 'var(--text-muted)' : '#fff' }}
                        >
                            {uploading ? 'Loading...' : 'Load into hub'}
                        </button>
                    </div>
                </div>
            )}

            {error && <div style={{ ...warnStyle, color: '#dc2626', marginTop: '8px' }}><AlertTriangle size={11} style={{ flexShrink: 0, marginTop: '1px' }} /> {error}</div>}
            {report && <UploadReport dataspaceId={dataspaceId} report={report} />}
        </div>
    );
};

const CatalogProfilesTab = ({ dataspaceId, onCountChange, onChange }) => {
    const [profiles, setProfiles] = useState(null);
    const [model, setModel] = useState(null);
    const [error, setError] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const query = `?dataspaceId=${encodeURIComponent(dataspaceId)}`;

    useEffect(() => {
        fetch(`${API_BASE}/vocabhub/catalog-profiles${query}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
            .then((data) => { setProfiles(data); onCountChange?.(data.length); })
            .catch(() => setError('Vocabulary Hub unavailable'));
        // The model, not the setting, says what is in use: a chosen profile that was deleted no longer is.
        fetch(`${API_BASE}/dataspaces/${encodeURIComponent(dataspaceId)}/catalog-model`)
            .then((r) => (r.ok ? r.json() : null))
            .then(setModel)
            .catch(() => setModel(null));
    }, [dataspaceId, query, reloadKey, onCountChange]);

    const changed = () => {
        setReloadKey((k) => k + 1);
        onChange?.();
    };

    const use = async (profile) => {
        await fetch(`${API_BASE}/dataspaces/${encodeURIComponent(dataspaceId)}/settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ catalog: { profileId: profile.id } }),
        });
        changed();
    };

    const remove = async (profile) => {
        await fetch(`${API_BASE}/vocabhub/profiles/${encodeURIComponent(profile.id)}${query}`, { method: 'DELETE' });
        changed();
    };

    return (
        <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', padding: '8px 0 0', lineHeight: 1.45 }}>
                A catalog profile is the data model for this dataspace's catalog entries. Its SHACL shapes
                say which fields an entry has and which of them are required.
            </div>
            {model && (
                <div style={{ fontSize: '0.74rem', color: 'var(--text-primary)', padding: '6px 0 0' }}>
                    Catalog uses <strong>{model.title}</strong>
                    {model.source === 'default' && <span style={{ color: 'var(--text-muted)' }}>, the simulator's built-in default</span>}
                </div>
            )}
            <UploadForm dataspaceId={dataspaceId} onUploaded={changed} />
            {error && <div style={{ ...warnStyle, padding: '10px 0' }}>{error}</div>}
            {!error && !profiles && <div style={{ ...labelStyle, padding: '10px 0' }}>Loading...</div>}
            {profiles && profiles.length === 0 && (
                <div style={{ ...labelStyle, textTransform: 'none', padding: '12px 0' }}>This hub holds no catalog profile yet.</div>
            )}
            {(profiles || []).map((p) => (
                <ProfileEntry key={p.id} dataspaceId={dataspaceId} profile={p} inUse={model?.source === 'hub' && p.id === model.profileId} onUse={use} onDelete={remove} />
            ))}
        </div>
    );
};

export default CatalogProfilesTab;
