import React, { useState, useEffect } from 'react';
import { X, Building2 } from 'lucide-react';
import './Components.css';
import CredentialValues from './CredentialValues';
import { INDUSTRIES, ORG_ROLES, credentialOptions, toList } from './credentials';

// Auto-generate a DID from a participant name
function generateDid(name) {
    if (!name) return '';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28);
    const suffix = Math.random().toString(36).slice(2, 5);
    return `did:web:${slug}-${suffix}.sim.local`;
}

const toPreset = (p) => ({
    name: p.name,
    bpn: p.bpn,
    location: p.location,
    domain: p.domain,
    roles: p.roles,
    ontologies: p.ontologies,
    dataCategories: p.dataCategories,
    formats: p.formats,
    tags: p.tags,
    metadata: { ...(p.credentials || {}) },
});

// The scenarios this dataspace already draws participants from, or every scenario if none.
const presetGroups = (scenarios, existingDids) => {
    const drawnOn = scenarios.filter((s) => s.participants.some((p) => existingDids.includes(p.bpn)));
    return (drawnOn.length > 0 ? drawnOn : scenarios)
        .map((s) => ({ name: s.name, presets: s.participants.filter((p) => !existingDids.includes(p.bpn)).map(toPreset) }))
        .filter((g) => g.presets.length > 0);
};


const NameDialog = ({ isOpen, onClose, onConfirm, editMode = false, initialData = null, existingNodes = {} }) => {
    const [name, setName] = useState('');
    const [did, setDid] = useState('');
    const [industry, setIndustry] = useState([]);
    const [orgRole, setOrgRole] = useState([]);
    const [showPresets, setShowPresets] = useState(true);
    const [hoverPreview, setHoverPreview] = useState(null);
    const [scenarios, setScenarios] = useState([]);

    useEffect(() => {
        if (!isOpen || editMode) return undefined;
        let cancelled = false;
        fetch('/api/scenarios')
            .then((r) => (r.ok ? r.json() : []))
            .then((data) => { if (!cancelled) setScenarios(Array.isArray(data) ? data : []); })
            .catch(() => { if (!cancelled) setScenarios([]); });
        return () => { cancelled = true; };
    }, [isOpen, editMode]);

    useEffect(() => {
        if (isOpen) {
            const d = editMode && initialData ? initialData : null;
            setName(d?.name || '');
            setDid(d?.bpn || d?.did || '');
            setIndustry(toList(d?.metadata?.industry));
            setOrgRole(toList(d?.metadata?.orgRole));
            setShowPresets(true);
        }
    }, [isOpen, editMode, initialData]);

    // Auto-generate DID when name changes (create mode only)
    useEffect(() => {
        if (!editMode) {
            setDid(name.trim().length >= 3 ? generateDid(name.trim()) : '');
        }
    }, [name, editMode]);

    const existingDids = Object.values(existingNodes).map(n => n.bpn || n.did);
    const groups = presetGroups(scenarios, existingDids);
    const participants = Object.values(existingNodes);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim() || !did.trim()) return;
        onConfirm({
            name: name.trim(),
            bpn: did.trim(),  // 'bpn' key kept for backward compat with the rest of the app
            metadata: { industry: industry.join(', '), orgRole: orgRole.join(', ') },
        });
        setName(''); setDid(''); setIndustry([]); setOrgRole([]);
    };

    const handleClose = () => { setName(''); setDid(''); setIndustry([]); setOrgRole([]); setHoverPreview(null); onClose(); };

    const inputStyle = {
        width: '100%', padding: '9px 12px', background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)', borderRadius: '8px',
        color: 'var(--text-primary)', fontSize: '0.88rem', boxSizing: 'border-box'
    };
    const labelStyle = {
        display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem',
        marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em'
    };
    const previewPos = hoverPreview
        ? {
            left: `${Math.min(hoverPreview.x + 14, window.innerWidth - 300)}px`,
            top: `${Math.min(hoverPreview.y + 14, window.innerHeight - 140)}px`,
        }
        : null;

    return (
        <div className="dialog-overlay">
            <div className="dialog-content" style={{ width: '460px', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3 style={{ margin: 0 }}>{editMode ? 'Edit Participant' : 'Add Participant'}</h3>
                    <button onClick={handleClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ overflow: 'auto', flex: 1, paddingRight: '2px' }}>
                    {/* Quick Select Presets */}
                    {!editMode && groups.length > 0 && (
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                <span style={{ fontSize: '0.72rem', color: '#22c55e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick Select</span>
                                <button type="button" onClick={() => setShowPresets(v => !v)}
                                    style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.75rem' }}>
                                    {showPresets ? 'Hide' : 'Show'}
                                </button>
                            </div>
                            {showPresets && (
                                <>
                                    {groups.map((group) => (
                                        <div key={group.name} style={{ marginBottom: '10px' }}>
                                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '6px' }}>{group.name}</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                                                {group.presets.map((preset) => (
                                                    <button key={preset.bpn} type="button"
                                                        onClick={() => { onConfirm(preset); setName(''); setDid(''); setIndustry([]); setOrgRole([]); }}
                                                        onMouseEnter={(e) => setHoverPreview({ preset, x: e.clientX, y: e.clientY })}
                                                        onMouseMove={(e) => setHoverPreview((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY } : prev)}
                                                        onMouseLeave={() => setHoverPreview(null)}
                                                        style={{
                                                            padding: '10px 12px',
                                                            background: 'rgba(34,197,94,0.12)',
                                                            border: '1px solid rgba(34,197,94,0.35)',
                                                            borderRadius: '8px',
                                                            cursor: 'pointer',
                                                            textAlign: 'left',
                                                            transition: 'background 120ms ease'
                                                        }}
                                                        onMouseOver={e => e.currentTarget.style.background = 'rgba(34,197,94,0.22)'}
                                                        onMouseOut={e => e.currentTarget.style.background = 'rgba(34,197,94,0.12)'}
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <Building2 size={15} color="#22c55e" />
                                                            <div>
                                                                <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)' }}>{preset.name}</div>
                                                                <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{preset.location}</div>
                                                            </div>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}

                                    {hoverPreview?.preset && previewPos && (
                                        <div
                                            style={{
                                                position: 'fixed',
                                                left: previewPos.left,
                                                top: previewPos.top,
                                                width: '280px',
                                                background: 'rgba(15, 23, 42, 0.97)',
                                                border: '1px solid rgba(56, 189, 248, 0.35)',
                                                borderRadius: '10px',
                                                padding: '10px 12px',
                                                boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
                                                color: '#cbd5e1',
                                                fontSize: '0.75rem',
                                                zIndex: 4000,
                                                pointerEvents: 'none'
                                            }}
                                        >
                                            <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: '6px', fontSize: '0.8rem' }}>
                                                {hoverPreview.preset.name}
                                            </div>
                                            <div>Industry: <span style={{ color: '#f8fafc' }}>{hoverPreview.preset?.metadata?.industry || 'n/a'}</span></div>
                                            <div>Org. Role: <span style={{ color: '#f8fafc' }}>{hoverPreview.preset?.metadata?.orgRole || 'n/a'}</span></div>
                                            <div style={{ marginTop: '4px', fontFamily: 'monospace', fontSize: '0.7rem', color: '#94a3b8' }}>
                                                {hoverPreview.preset?.bpn || 'n/a'}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                            <div style={{ borderBottom: '1px solid var(--border-subtle)', marginBottom: '16px', position: 'relative' }}>
                                <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '-10px', background: 'var(--bg-card)', padding: '0 12px', color: '#64748b', fontSize: '0.75rem' }}>
                                    or enter manually
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Name */}
                    <div style={{ marginBottom: '12px' }}>
                        <label style={labelStyle}>Participant Name *</label>
                        <input type="text" value={name} autoFocus onChange={e => setName(e.target.value)}
                            style={inputStyle} />
                    </div>

                    {/* DID */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
                            <span>DID (auto-generated)</span>
                            {!editMode && <span style={{ color: '#475569', fontWeight: 400, fontSize: '0.7rem', textTransform: 'none' }}>editable</span>}
                        </label>
                        <input type="text" value={did} onChange={e => setDid(e.target.value.toLowerCase())} placeholder="did:web:…"
                            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.82rem', color: did ? 'var(--text-secondary)' : 'var(--text-muted)' }} />
                        {!editMode && name.trim().length >= 3 && (
                            <button type="button" onClick={() => setDid(generateDid(name.trim()))}
                                style={{ marginTop: '4px', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.72rem', padding: 0 }}>
                                ↻ Regenerate
                            </button>
                        )}
                    </div>

                    {/* Credentials — evaluated by the policy engine */}
                    <div style={{ padding: '12px', background: 'var(--bg-surface)', borderRadius: '10px', border: '1px solid var(--border-subtle)', marginBottom: '18px' }}>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
                            Credentials <span style={{ color: '#475569', fontWeight: 400 }}>— optional, used for policy evaluation</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div>
                                <label style={labelStyle}>Industry</label>
                                <CredentialValues options={credentialOptions(INDUSTRIES, participants, 'industry')} selected={industry} onChange={setIndustry} />
                            </div>
                            <div>
                                <label style={labelStyle}>Org. Role</label>
                                <CredentialValues options={credentialOptions(ORG_ROLES, participants, 'orgRole')} selected={orgRole} onChange={setOrgRole} />
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="dialog-actions" style={{ paddingTop: '14px', borderTop: '1px solid var(--border-subtle)' }}>
                        <button type="button" onClick={handleClose} className="dialog-btn cancel">Cancel</button>
                        <button type="submit" className="dialog-btn confirm"
                            disabled={!name.trim() || !did.trim()}
                            style={{ opacity: (!name.trim() || !did.trim()) ? 0.5 : 1 }}>
                            {editMode ? 'Save' : 'Add'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default NameDialog;
