import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
    X, Upload, FileJson, FileText, CheckCircle, AlertCircle,
    Globe, Users, Factory, Briefcase, Plus, XCircle, Info
} from 'lucide-react';
import { BASIC_PATHS, STATUSES, flattenFields, shortIri, valuesAt } from './catalogFields';
import { INDUSTRIES, ORG_ROLES, credentialOptions } from './credentials';

const API_BASE = '/api';

/* ── catalog profile fields ─────────────────────────────────────── */
const IRI_PATTERN = /^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]+$/i;

const formFields = (model) => (model ? flattenFields(model.fields).filter((f) => !BASIC_PATHS.includes(f.path[0])) : []);
const isMulti = (f) => !f.in && f.max !== 1;
const asIri = (f, text) => f.kind === 'iri' || (f.in && IRI_PATTERN.test(text));
const textOf = (f, values) => {
    const texts = values.map((v) => v.iri || v.value);
    return isMulti(f) ? texts.join(', ') : (texts[0] || '');
};

// One node per nested path, so two distributions come back as one.
const LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';
const literalOf = (f, text, language) => (f.datatypeIri && f.datatypeIri !== LANG_STRING
    ? { value: text, datatype: f.datatypeIri }
    : { value: text, ...(language ? { lang: language } : {}) });

const buildRecord = (fields, entries, language) => {
    const record = {};
    for (const entry of entries) {
        const f = fields.find((x) => x.key === entry.key);
        if (!f) continue;
        const texts = (isMulti(f) ? entry.text.split(',') : [entry.text]).map((t) => t.trim()).filter(Boolean);
        if (texts.length === 0) continue;
        let node = record;
        f.path.slice(0, -1).forEach((p, i) => {
            const type = f.nodeTypes[i];
            if (!node[p]) node[p] = [{ ...(type ? { type } : {}), fields: {} }];
            node = node[p][0].fields;
        });
        node[f.path[f.path.length - 1]] = texts.map((t) => (asIri(f, t) ? { iri: t } : literalOf(f, t, language)));
    }
    return record;
};

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
    dataspaceId,
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

    const [model, setModel] = useState(null);
    const [modelError, setModelError] = useState(null);
    const [stored, setStored] = useState(null);
    const [entries, setEntries] = useState([]);
    // Top-level paths the user changed; the rest of a stored record is written back as it was.
    const [touched, setTouched] = useState(new Set());
    const [picker, setPicker] = useState('');

    const [publishing, setPublishing] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);

    // Participants, for the DID group's choices and the credential values the dataspace uses
    useEffect(() => {
        if (['sys-did-group', 'sys-industry', 'sys-role'].includes(selectedPolicy)) {
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
        } else {
            setFile(null); setTitle(''); setDescription('');
            setSelectedPolicy('sys-open'); setSelectedValues([]);
        }
        setEntries([]); setTouched(new Set()); setPicker('');
        setError(null); setDone(false); setPublishing(false);
    }, [isOpen, mode, initialAsset]);

    // Mandatory fields start in the form; an edit also starts with every field the entry fills.
    useEffect(() => {
        if (!isOpen) return undefined;
        let cancelled = false;
        const assetId = mode === 'edit' ? initialAsset?.id : null;
        const json = (r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)));
        Promise.all([
            fetch(`${API_BASE}/dataspaces/${encodeURIComponent(dataspaceId || 'demo')}/catalog-model`).then(json),
            assetId ? fetch(`${API_BASE}/assets/${encodeURIComponent(assetId)}`).then(json).then((a) => a.record || {}) : null,
        ]).then(([m, record]) => {
            if (cancelled) return;
            setModel(m); setStored(record); setModelError(null);
            setEntries(formFields(m)
                .filter((f) => f.status === 'mandatory' || valuesAt(record, f.path).length > 0)
                .map((f) => ({ key: f.key, text: textOf(f, valuesAt(record, f.path)) })));
        }).catch((err) => {
            if (cancelled) return;
            setModel(null); setStored(null); setModelError(err.message);
        });
        return () => { cancelled = true; };
    }, [isOpen, mode, initialAsset, dataspaceId]);

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

    const fields = formFields(model);

    const touch = (key) => {
        const path = fields.find((f) => f.key === key)?.path[0];
        if (path) setTouched((prev) => new Set(prev).add(path));
    };
    const setEntryText = (key, text) => {
        setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, text } : e)));
        touch(key);
    };
    const addEntry = (key) => {
        if (!key || entries.some((e) => e.key === key)) return;
        setEntries((prev) => [...prev, { key, text: '' }]);
        setPicker('');
    };
    const removeEntry = (key) => {
        setEntries((prev) => prev.filter((e) => e.key !== key));
        touch(key);
    };

    const buildDcatPayload = () => {
        const fromForm = buildRecord(fields, entries, model?.language);
        if (mode !== 'edit') return { record: fromForm };
        // Without the stored record the form cannot tell what it would overwrite, so it sends nothing.
        if (!stored) return undefined;
        const record = Object.fromEntries(Object.entries(stored).filter(([p]) => !BASIC_PATHS.includes(p) && !touched.has(p)));
        for (const [p, values] of Object.entries(fromForm)) if (touched.has(p)) record[p] = values;
        return { record };
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
                description: description.trim(),
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

    const usedKeys = new Set(entries.map(e => e.key));
    const available = fields.filter(f => !usedKeys.has(f.key));
    const activePol = POLICIES.find(p => p.id === selectedPolicy);

    // Build the options list for the active policy constraint
    const getConstraintOptions = () => {
        if (!activePol?.constraint) return [];
        const inDataspace = availableNodes.filter(n => (n.metadata?.dataspaceId || 'demo') === dataspaceId);
        if (activePol.constraint.type === 'industry') return credentialOptions(INDUSTRIES, inDataspace, 'industry');
        if (activePol.constraint.type === 'role') return credentialOptions(ORG_ROLES, inDataspace, 'orgRole');
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
                // A portal still bubbles React events to the canvas, which zooms on wheel and click.
                onWheel={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
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
                    ) : !model && !modelError ? (
                        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading the catalog profile…</div>
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

                        {/* Catalog metadata */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={lbl}>Catalog Metadata</label>
                            {model && <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', margin: '-2px 0 8px' }}>Fields from {model.title}</div>}
                            {modelError && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px', color: '#d97706', fontSize: '0.75rem' }}>
                                    <AlertCircle size={12} /> Catalog profile unavailable ({modelError}){mode === 'edit' ? ', so the metadata stays as it is' : ''}
                                </div>
                            )}
                            {entries.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
                                    {entries.map(e => {
                                        const f = fields.find(x => x.key === e.key);
                                        if (!f) return null;
                                        const notIri = f.kind === 'iri' && (isMulti(f) ? e.text.split(',') : [e.text])
                                            .map(t => t.trim()).some(t => t && !IRI_PATTERN.test(t));
                                        const placeholder = [f.kind === 'iri' ? 'https://…' : f.datatype, isMulti(f) ? 'comma-separated' : null].filter(Boolean).join(', ');
                                        return (
                                            <div key={e.key}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                    <label title={f.description || f.curie} style={{ color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 600, margin: 0 }}>
                                                        {f.label}{f.status === 'mandatory' ? ' *' : ''}
                                                    </label>
                                                    {f.status !== 'mandatory' && (
                                                        <button type="button" onClick={() => removeEntry(e.key)}
                                                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px' }}>
                                                            <XCircle size={13} />
                                                        </button>
                                                    )}
                                                </div>
                                                {f.in ? (
                                                    <select value={e.text} onChange={ev => setEntryText(e.key, ev.target.value)} style={inp}>
                                                        <option value="">Choose…</option>
                                                        {f.in.map(v => <option key={v} value={v}>{shortIri(v)}</option>)}
                                                    </select>
                                                ) : (
                                                    <input
                                                        type="text"
                                                        value={e.text}
                                                        onChange={ev => setEntryText(e.key, ev.target.value)}
                                                        placeholder={placeholder}
                                                        style={inp}
                                                        spellCheck={false}
                                                    />
                                                )}
                                                {notIri && <div style={{ color: '#d97706', fontSize: '0.72rem', marginTop: '3px' }}>Needs a full IRI, such as https://…; other text is dropped.</div>}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {available.length > 0 && (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select
                                        value={picker}
                                        onChange={(e) => setPicker(e.target.value)}
                                        style={{ ...inp, flex: 1 }}
                                    >
                                        <option value="">Select metadata field...</option>
                                        {STATUSES.map(s => {
                                            const group = available.filter(f => f.status === s);
                                            return group.length > 0 && (
                                                <optgroup key={s} label={s[0].toUpperCase() + s.slice(1)}>
                                                    {group.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                                                </optgroup>
                                            );
                                        })}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => addEntry(picker)}
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
