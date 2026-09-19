import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
    X, Upload, FileJson, FileText, CheckCircle, AlertCircle,
    Globe, Users, Factory, Briefcase, Plus, XCircle, Info
} from 'lucide-react';

const API_BASE = '/api';

/* ── DCAT fields ────────────────────────────────────────────────── */
const DCAT_OPTIONS = [
    { key: 'dcat:keyword', label: 'Keywords', placeholder: 'BIM, IFC…', multi: true },
    { key: 'dcat:theme', label: 'Themes', placeholder: 'sustainability…', multi: true },
    { key: 'dct:spatial', label: 'Spatial / Region', placeholder: 'DE, Munich…', multi: true },
    { key: 'dct:temporal', label: 'Temporal', placeholder: '2026-01/2026-12', multi: false },
    { key: 'dct:language', label: 'Language', placeholder: 'de, en', multi: true },
    { key: 'dct:format', label: 'Format', placeholder: 'application/json', multi: false },
    { key: 'dct:license', label: 'License', placeholder: 'CC-BY-4.0', multi: false },
    { key: 'dct:creator', label: 'Creator', placeholder: 'Team DataOps', multi: true },
    { key: 'dct:conformsTo', label: 'Conforms To', placeholder: 'DIN EN ISO 16739', multi: true },
    { key: 'dcat:landingPage', label: 'Landing Page', placeholder: 'https://…', multi: false },
    { key: 'dcat:contactPoint', label: 'Contact Point', placeholder: 'data@company.com', multi: false },
    { key: 'dct:accrualPeriodicity', label: 'Update Frequency', placeholder: 'daily, weekly', multi: false },
    { key: 'mobilitydcatap:mobilityTheme', label: 'Mobility Theme', placeholder: 'Traffic data…', multi: true },
    { key: 'mobilitydcatap:transportMode', label: 'Transport Mode', placeholder: 'Road…', multi: true },
    { key: 'mobilitydcatap:networkCoverage', label: 'Network Coverage', placeholder: 'Urban road network…', multi: false },
    { key: 'mobilitydcatap:georeferencingMethod', label: 'Georeferencing Method', placeholder: 'WGS84 coordinates…', multi: false },
    { key: 'mobilitydcatap:intendedInformationService', label: 'Intended Information Service', placeholder: 'Real-time traffic information…', multi: true },
];

/* ── fixed credential option sets ──────────────────────────────── */
const INDUSTRY_OPTS = ['construction', 'manufacturing', 'logistics', 'energy', 'automotive'];
const ROLE_OPTS = ['customer', 'contractor', 'supplier', 'manufacturer'];

/* ── policy definitions ─────────────────────────────────────────── */
const POLICIES = [
    { id: 'sys-open', label: 'Open', icon: Globe, color: '#22c55e', desc: 'No restrictions', constraint: null },
    { id: 'sys-did-group', label: 'DID Group', icon: Users, color: '#3b82f6', desc: 'Specific DIDs', constraint: { key: 'cx-policy:consumerDid', type: 'did', label: 'Allowed DID(s)' } },
    { id: 'sys-industry', label: 'Industry', icon: Factory, color: '#f97316', desc: 'By sector', constraint: { key: 'cx-policy:industry', type: 'industry', label: 'Allowed sector(s)' } },
    { id: 'sys-role', label: 'Role', icon: Briefcase, color: '#a855f7', desc: 'By org. role', constraint: { key: 'cx-policy:orgRole', type: 'role', label: 'Allowed role(s)' } },
];

/* ── shared styles ──────────────────────────────────────────────── */
const inp = {
    width: '100%', padding: '9px 11px',
    background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
    borderRadius: '7px', color: 'var(--text-primary)', fontSize: '0.87rem',
    boxSizing: 'border-box', outline: 'none',
};
const lbl = {
    display: 'block', color: 'var(--text-muted)', fontSize: '0.74rem',
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px',
};

/* ── multi-select chip grid ─────────────────────────────────────── */
function ChipSelect({ options, selected, onChange, color }) {
    const toggle = v => onChange(
        selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]
    );
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {options.map(o => {
                const active = selected.includes(o);
                return (
                    <button key={o} type="button" onClick={() => toggle(o)}
                        style={{
                            padding: '4px 12px', borderRadius: '100px', fontSize: '0.78rem',
                            cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
                            // stable border (same width always, just color changes → no reflow)
                            border: `1.5px solid ${active ? color : 'var(--border-subtle)'}`,
                            background: active ? `${color}22` : 'var(--bg-surface)',
                            color: active ? color : 'var(--text-secondary)',
                            // stable font-weight: always 600 to prevent width shift
                            fontWeight: 600,
                            minWidth: 'max-content',
                        }}>
                        {o}
                    </button>
                );
            })}
        </div>
    );
}


/* ── main dialog ────────────────────────────────────────────────── */
export default function PublishAssetDialog({
    isOpen,
    onClose,
    onPublish,
    participantName,
    mode = 'create',
    initialAsset = null,
    onSaveAsset,
}) {
    const [file, setFile] = useState(null);
    const [dragging, setDragging] = useState(false);
    const fileRef = useRef();

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [selectedPolicy, setSelectedPolicy] = useState('sys-open');
    // selected constraint values (array of strings)
    const [selectedValues, setSelectedValues] = useState([]);

    // Available nodes for DID-group selection
    const [availableNodes, setAvailableNodes] = useState([]);

    const [dcatFields, setDcatFields] = useState([]);
    const [dcatDropdown, setDcatDropdown] = useState('');

    const [publishing, setPublishing] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);

    // Fetch nodes when DID Group policy is selected
    useEffect(() => {
        if (selectedPolicy === 'sys-did-group') {
            fetch(`${API_BASE}/nodes`)
                .then(r => r.json())
                .then(nodes => setAvailableNodes(Array.isArray(nodes) ? nodes : []))
                .catch(() => setAvailableNodes([]));
        }
    }, [selectedPolicy]);

    useEffect(() => {
        if (!isOpen) return;
        if (mode === 'edit' && initialAsset) {
            setFile({
                name: initialAsset.fileName || 'existing-asset.json',
                size: String(initialAsset.content || '').length,
                type: 'text/plain',
                text: async () => String(initialAsset.content || ''),
            });
            setTitle(initialAsset.name || '');
            setDescription(initialAsset.description || initialAsset?.dcatFields?.description || '');
            setSelectedPolicy(initialAsset.policyId || 'sys-open');
            setSelectedValues([]);
            setDcatFields(hydrateDcatFields(initialAsset.dcatFields || {}));
            setDcatDropdown('');
        } else {
            setFile(null); setTitle(''); setDescription('');
            setSelectedPolicy('sys-open'); setSelectedValues([]);
            setDcatFields([]); setDcatDropdown('');
        }
        setError(null); setDone(false); setPublishing(false);
    }, [isOpen, mode, initialAsset]);

    useEffect(() => {
        if (!isOpen || mode !== 'edit') return;
        const policyId = initialAsset?.policyId;
        if (!policyId || policyId === 'sys-open') {
            setSelectedValues([]);
            return;
        }
        fetch(`${API_BASE}/policies/${encodeURIComponent(policyId)}`)
            .then(r => (r.ok ? r.json() : null))
            .then(pol => {
                const value = pol?.constraints?.[0]?.value || '';
                setSelectedValues(String(value).split(',').map(s => s.trim()).filter(Boolean));
            })
            .catch(() => setSelectedValues([]));
    }, [isOpen, mode, initialAsset?.policyId]);

    const pick = f => {
        const name = (f?.name || '').toLowerCase();
        const isJson = f?.type === 'application/json' || name.endsWith('.json');
        const isCsv = f?.type === 'text/csv' || name.endsWith('.csv');
        const isTxt = f?.type === 'text/plain' || name.endsWith('.txt');
        if (!f || !(isJson || isCsv || isTxt)) {
            setError('Only JSON, CSV or TXT files are supported.'); return;
        }
        setFile(f);
        if (!title) setTitle(f.name.replace(/\.(json|csv|txt)$/i, ''));
        setError(null);
    };

    const addDcatField = key => {
        if (!key || dcatFields.find(f => f.key === key)) return;
        setDcatFields(prev => [...prev, { key, value: '' }]);
        setDcatDropdown('');
    };

    const buildDcatPayload = () => {
        const split = v => v.split(',').map(s => s.trim()).filter(Boolean);
        const kw = dcatFields.find(f => f.key === 'dcat:keyword')?.value || '';
        const th = dcatFields.find(f => f.key === 'dcat:theme')?.value || '';
        const sp = dcatFields.find(f => f.key === 'dct:spatial')?.value || '';
        const add = dcatFields
            .filter(f => !['dcat:keyword', 'dcat:theme', 'dct:spatial'].includes(f.key) && f.value.trim())
            .map(f => ({ key: f.key, value: f.value.trim() }));
        return { title: title.trim(), description: description.trim(), keywords: split(kw), themes: split(th), spatial: split(sp), additionalDcat: add };
    };

    const handlePublish = async () => {
        if (mode !== 'edit' && !file) return setError('Please select a JSON, CSV or TXT file.');
        if (!title.trim()) return setError('Title is required.');
        const pol = POLICIES.find(p => p.id === selectedPolicy);
        if (pol?.constraint && selectedValues.length === 0) {
            return setError(`Please select at least one ${pol.constraint.label.toLowerCase()}.`);
        }
        setPublishing(true); setError(null);
        try {
            let parsedContent = null;
            if (mode === 'edit') {
                const existing = initialAsset?.content;
                if (typeof existing === 'string') {
                    try {
                        parsedContent = JSON.parse(existing);
                    } catch {
                        parsedContent = existing;
                    }
                } else {
                    parsedContent = existing ?? '';
                }
            } else {
                const fileText = await file.text();
                try {
                    parsedContent = JSON.parse(fileText);
                } catch {
                    parsedContent = fileText;
                }
            }

            let policyId = null;
            if (selectedPolicy !== 'sys-open' && pol?.constraint) {
                policyId = selectedPolicy;
                await fetch(`${API_BASE}/policies`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        policyId: selectedPolicy,
                        name: pol.label,
                        constraintOperand: 'Or',
                        constraints: [{ key: pol.constraint.key, operator: 'In', value: selectedValues.join(', ') }],
                    }),
                });
            }
            const payload = {
                name: title.trim(),
                fileName: mode === 'edit' ? (initialAsset?.fileName || '') : file.name,
                content: parsedContent,
                policyId,
                dcatFields: buildDcatPayload(),
            };

            if (mode === 'edit') {
                await onSaveAsset?.(payload);
            } else {
                await onPublish(payload);
            }
            setDone(true);
            setTimeout(() => { setDone(false); onClose(); }, 1400);
        } catch (e) {
            setError(e.message || (mode === 'edit' ? 'Update failed.' : 'Publish failed.'));
        } finally {
            setPublishing(false);
        }
    };

    if (!isOpen) return null;

    const usedKeys = new Set(dcatFields.map(f => f.key));
    const availableOptsDcat = DCAT_OPTIONS.filter(o => !usedKeys.has(o.key));
    const activePol = POLICIES.find(p => p.id === selectedPolicy);

    // Build the options list for the active policy constraint
    const getConstraintOptions = () => {
        if (!activePol?.constraint) return [];
        if (activePol.constraint.type === 'industry') return INDUSTRY_OPTS;
        if (activePol.constraint.type === 'role') return ROLE_OPTS;
        if (activePol.constraint.type === 'did') {
            // DID nodes: show name + bpn (DID)
            return availableNodes.map(n => n.bpn || n.id).filter(Boolean);
        }
        return [];
    };

    // For DID group, show node name alongside the DID
    const renderDidChips = () => {
        const nodes = availableNodes.filter(n => n.bpn);
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {nodes.length === 0 && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No other participants in the dataspace yet.</span>
                )}
                {nodes.map(n => {
                    const active = selectedValues.includes(n.bpn);
                    return (
                        <button key={n.id} type="button"
                            onClick={() => setSelectedValues(
                                active ? selectedValues.filter(v => v !== n.bpn) : [...selectedValues, n.bpn]
                            )}
                            style={{
                                padding: '5px 12px', borderRadius: '100px', fontSize: '0.78rem',
                                cursor: 'pointer', transition: 'all 0.12s',
                                border: `1.5px solid ${active ? '#3b82f6' : 'var(--border-subtle)'}`,
                                background: active ? '#3b82f622' : 'var(--bg-surface)',
                                color: active ? '#3b82f6' : 'var(--text-secondary)',
                                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '1px',
                                fontWeight: active ? 600 : 400,
                                textAlign: 'left',
                            }}>
                            <span>{n.name}</span>
                            <span style={{ fontSize: '0.65rem', opacity: 0.7, fontFamily: 'monospace' }}>{n.bpn}</span>
                        </button>
                    );
                })}
            </div>
        );
    };

    const modal = (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onMouseDown={onClose}
                style={{ position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.98)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
            >
                <motion.div
                    initial={{ y: 14, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 14, opacity: 0 }} transition={{ duration: 0.18 }}
                    onMouseDown={e => e.stopPropagation()}
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: '26px', width: 'min(640px, 94vw)', maxHeight: '90vh', overflowY: 'auto', scrollbarGutter: 'stable', boxShadow: '0 25px 50px rgba(0,0,0,0.45)' }}
                >
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                        <div>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1.05rem' }}>{mode === 'edit' ? 'Edit Asset' : 'Publish Asset'}</div>
                            {participantName && <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>as {participantName}</div>}
                        </div>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={18} /></button>
                    </div>

                    {done ? (
                        <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', color: '#10b981' }}>
                            <CheckCircle size={56} /><p style={{ margin: '12px 0 0', fontWeight: 600 }}>{mode === 'edit' ? 'Saved!' : 'Published!'}</p>
                        </motion.div>
                    ) : (<>

                        {/* Drop Zone */}
                        <div
                            onDragOver={mode === 'edit' ? undefined : (e => { e.preventDefault(); setDragging(true); })}
                            onDragLeave={mode === 'edit' ? undefined : (() => setDragging(false))}
                            onDrop={mode === 'edit' ? undefined : (e => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); })}
                            onClick={mode === 'edit' ? undefined : (() => fileRef.current?.click())}
                            style={{ border: `2px dashed ${mode === 'edit' ? 'var(--border-subtle)' : (dragging ? '#3b82f6' : file ? '#10b981' : 'var(--border-subtle)')}`, borderRadius: '10px', padding: '18px', textAlign: 'center', cursor: mode === 'edit' ? 'default' : 'pointer', background: mode === 'edit' ? 'var(--bg-surface)' : (dragging ? 'rgba(59,130,246,0.06)' : file ? 'rgba(16,185,129,0.06)' : 'transparent'), transition: 'all 0.15s', marginBottom: '18px' }}
                        >
                            <input ref={fileRef} type="file" accept=".json,.csv,.txt,application/json,text/csv,text/plain" onChange={e => pick(e.target.files[0])} style={{ display: 'none' }} disabled={mode === 'edit'} />
                            {file
                                ? <>{(file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') ? <FileJson size={28} color="#10b981" /> : <FileText size={28} color="#10b981" />}<p style={{ margin: '6px 0 1px', fontWeight: 500, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>{file.name}</p><p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.72rem' }}>{(file.size / 1024).toFixed(1)} KB{mode === 'edit' ? '  ·  File cannot be changed' : ''}</p></>
                                : <><Upload size={26} color={dragging ? '#3b82f6' : 'var(--text-muted)'} /><p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Drop JSON, CSV or TXT or click to select</p></>
                            }
                        </div>

                        {/* Title + Description */}
                        <div style={{ marginBottom: '12px' }}>
                            <label style={lbl}>Title (dct:title) *</label>
                            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Concrete Delivery Q4 2026" style={inp} spellCheck={false} />
                        </div>
                        <div style={{ marginBottom: '18px' }}>
                            <label style={lbl}>Description (dct:description)</label>
                            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this dataset contain?" rows={2} style={{ ...inp, resize: 'vertical', minHeight: '54px' }} spellCheck={false} />
                        </div>

                        {/* Access Policy */}
                        <div style={{ marginBottom: '18px' }}>
                            <label style={lbl}>Access Policy</label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', marginBottom: activePol?.constraint ? '12px' : 0 }}>
                                {POLICIES.map(p => {
                                    const Icon = p.icon;
                                    const active = selectedPolicy === p.id;
                                    return (
                                        <button key={p.id} type="button" onClick={() => { setSelectedPolicy(p.id); setSelectedValues([]); }}
                                            style={{ padding: '10px 6px', borderRadius: '8px', cursor: 'pointer', border: `1.5px solid ${active ? p.color : 'var(--border-subtle)'}`, background: active ? `${p.color}18` : 'var(--bg-surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', transition: 'all 0.15s' }}>
                                            <Icon size={16} color={active ? p.color : 'var(--text-muted)'} />
                                            <span style={{ fontSize: '0.72rem', fontWeight: active ? 600 : 400, color: active ? p.color : 'var(--text-muted)' }}>{p.label}</span>
                                            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.2 }}>{p.desc}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Constraint chip selector */}
                            <AnimatePresence>
                                {activePol?.constraint && (
                                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                                        style={{ padding: '12px', background: `${activePol.color}0e`, border: `1px solid ${activePol.color}40`, borderRadius: '8px' }}>
                                        <label style={{ ...lbl, color: activePol.color, marginBottom: '8px' }}>
                                            {activePol.constraint.label}
                                            {selectedValues.length > 0 && <span style={{ marginLeft: '6px', background: `${activePol.color}30`, padding: '1px 7px', borderRadius: '100px', fontSize: '0.68rem' }}>{selectedValues.length} selected</span>}
                                        </label>

                                        {activePol.constraint.type === 'did'
                                            ? renderDidChips()
                                            : <ChipSelect
                                                options={getConstraintOptions()}
                                                selected={selectedValues}
                                                onChange={setSelectedValues}
                                                color={activePol.color}
                                            />
                                        }

                                        {selectedValues.length > 0 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '8px', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                                <Info size={11} />
                                                Only participants matching one of the selected values can access this asset.
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* DCAT Metadata */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={lbl}>DCAT Metadata</label>
                            {dcatFields.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
                                    {dcatFields.map(f => {
                                        const opt = DCAT_OPTIONS.find(o => o.key === f.key);
                                        const placeholder = opt?.multi ? `${opt?.placeholder || ''} (comma-separated)` : opt?.placeholder;
                                        return (
                                            <div key={f.key}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                        <label style={{ color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 600, margin: 0 }}>
                                                            {opt?.label || f.key}
                                                        </label>
                                                    </div>
                                                    <button type="button" onClick={() => setDcatFields(prev => prev.filter(x => x.key !== f.key))}
                                                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px' }}>
                                                        <XCircle size={13} />
                                                    </button>
                                                </div>
                                                <input
                                                    type="text"
                                                    value={f.value}
                                                    onChange={e => setDcatFields(prev => prev.map(x => x.key === f.key ? { ...x, value: e.target.value } : x))}
                                                    placeholder={placeholder}
                                                    style={inp}
                                                    spellCheck={false}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {availableOptsDcat.length > 0 && (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select
                                        value={dcatDropdown}
                                        onChange={(e) => setDcatDropdown(e.target.value)}
                                        style={{ ...inp, flex: 1 }}
                                    >
                                        <option value="">Select metadata field...</option>
                                        {availableOptsDcat.map((o) => (
                                            <option key={o.key} value={o.key}>{o.label}</option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!dcatDropdown) return;
                                            addDcatField(dcatDropdown);
                                        }}
                                        style={{ padding: '0 12px', borderRadius: '7px', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.83rem' }}
                                    >
                                        <Plus size={14} /> Add
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Error */}
                        {error && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '8px', marginBottom: '14px', color: '#ef4444', fontSize: '0.84rem' }}>
                                <AlertCircle size={14} /> {error}
                            </div>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button type="button" onClick={onClose} style={{ flex: 1, padding: '11px', background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '8px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.88rem' }}>Cancel</button>
                            <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={handlePublish} disabled={((mode !== 'edit' && !file) || !title.trim() || publishing)}
                                style={{ flex: 2, padding: '11px', background: (((mode !== 'edit' && !file) || !title.trim() || publishing)) ? 'var(--bg-surface)' : '#f97316', border: 'none', borderRadius: '8px', color: (((mode !== 'edit' && !file) || !title.trim() || publishing)) ? 'var(--text-muted)' : '#fff', cursor: (((mode !== 'edit' && !file) || !title.trim() || publishing)) ? 'not-allowed' : 'pointer', fontSize: '0.9rem', fontWeight: 700 }}>
                                {publishing ? (mode === 'edit' ? 'Saving…' : 'Publishing…') : (mode === 'edit' ? 'Save Changes' : 'Publish Asset')}
                            </motion.button>
                        </div>

                    </>)}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );

    if (typeof document === 'undefined') return null;
    return createPortal(modal, document.body);
}

function hydrateDcatFields(dcat = {}) {
    const rows = [];
    if (Array.isArray(dcat.keywords) && dcat.keywords.length > 0) rows.push({ key: 'dcat:keyword', value: dcat.keywords.join(', ') });
    if (Array.isArray(dcat.themes) && dcat.themes.length > 0) rows.push({ key: 'dcat:theme', value: dcat.themes.join(', ') });
    if (Array.isArray(dcat.spatial) && dcat.spatial.length > 0) rows.push({ key: 'dct:spatial', value: dcat.spatial.join(', ') });
    for (const entry of (Array.isArray(dcat.additionalDcat) ? dcat.additionalDcat : [])) {
        if (!entry?.key) continue;
        rows.push({ key: entry.key, value: String(entry.value || '') });
    }
    return rows;
}
