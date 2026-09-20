import React, { useEffect, useState } from 'react';
import { X, Link2, Unlink, ArrowRight } from 'lucide-react';

const API_BASE = '/api';

const labelStyle = { fontSize: '0.64rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const publisherStyle = { fontSize: '0.68rem', color: 'var(--text-muted)' };
const uriStyle = { fontSize: '0.66rem', color: 'var(--color-primary)', fontFamily: 'monospace', wordBreak: 'break-all' };

const ProfileRow = ({ profile }) => {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ borderBottom: '1px solid var(--border-color)', padding: '8px 0' }}>
            <div onClick={() => setOpen(!open)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>{profile.title}</span>
                <span style={{ ...publisherStyle, whiteSpace: 'nowrap' }}>{profile.publisher}</span>
            </div>
            {open && (
                <div style={{ marginTop: '6px', paddingLeft: '10px', borderLeft: '2px solid var(--color-primary)' }}>
                    <div style={uriStyle}>{profile.id}</div>
                    {profile.description && (
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{profile.description}</div>
                    )}
                    {(profile.resources || []).map((resource) => (
                        <div key={resource.roleIri + resource.artifact} style={{ marginTop: '6px' }}>
                            <div style={labelStyle}>{resource.role}</div>
                            <div style={uriStyle}>{resource.artifact}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const AlignmentRow = ({ alignment }) => (
    <div style={{ borderBottom: '1px solid var(--border-color)', padding: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
            <span style={{ fontWeight: 600 }}>{alignment.source.title}</span>
            <ArrowRight size={13} color="var(--text-muted)" />
            <span style={{ fontWeight: 600 }}>{alignment.target.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px' }}>
            <div style={{ flex: 1, height: '5px', background: 'var(--bg-card)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${Math.round(alignment.coverage * 100)}%`, height: '100%', background: '#16a34a' }} />
            </div>
            <span style={{ ...labelStyle, whiteSpace: 'nowrap' }}>{Math.round(alignment.coverage * 100)}% coverage</span>
        </div>
    </div>
);

const VocabularyHubDialog = ({ isConnected, onClose }) => {
    const [tab, setTab] = useState('profiles');
    const [profiles, setProfiles] = useState(null);
    const [alignments, setAlignments] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        Promise.all([
            fetch(`${API_BASE}/vocabhub/profiles`).then((r) => r.json()),
            fetch(`${API_BASE}/vocabhub/alignments`).then((r) => r.json()),
        ])
            .then(([p, a]) => { setProfiles(p); setAlignments(a); })
            .catch(() => setError('Vocabulary Hub unavailable'));
    }, []);

    const tabStyle = (name) => ({
        padding: '6px 14px',
        fontSize: '0.8rem',
        fontWeight: 600,
        cursor: 'pointer',
        borderBottom: `2px solid ${tab === name ? 'var(--color-primary)' : 'transparent'}`,
        color: tab === name ? 'var(--color-primary)' : 'var(--text-muted)',
    });

    return (
        <div
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100 }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: '560px', maxHeight: '76vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px 18px' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#14532d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src="/assets/sth-logo.svg" alt="" style={{ width: '20px', height: '20px' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>Vocabulary Hub</div>
                        <div style={labelStyle}>Shared by every dataspace</div>
                    </div>
                    <X size={18} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={onClose} />
                </div>

                <div style={{
                    display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', padding: '7px 10px', borderRadius: '7px',
                    fontSize: '0.74rem',
                    background: isConnected ? 'rgba(22, 163, 74, 0.12)' : 'rgba(217, 119, 6, 0.12)',
                    color: isConnected ? '#15803d' : '#b45309',
                }}>
                    {isConnected ? <Link2 size={13} /> : <Unlink size={13} />}
                    {isConnected
                        ? 'Connected to this dataspace. Searches here can widen along alignments.'
                        : 'Not connected to this dataspace. Drag the hub closer to widen searches along alignments.'}
                </div>

                <div style={{ display: 'flex', gap: '4px', marginTop: '12px', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={tabStyle('profiles')} onClick={() => setTab('profiles')}>
                        Profiles{profiles ? ` (${profiles.length})` : ''}
                    </div>
                    <div style={tabStyle('alignments')} onClick={() => setTab('alignments')}>
                        Alignments{alignments ? ` (${alignments.length})` : ''}
                    </div>
                </div>

                <div style={{ overflowY: 'auto', marginTop: '4px' }}>
                    {error && <div style={{ fontSize: '0.78rem', color: '#b45309', padding: '10px 0' }}>{error}</div>}
                    {!error && !profiles && <div style={{ ...labelStyle, padding: '10px 0' }}>Loading...</div>}

                    {tab === 'profiles' && (profiles || []).map((profile) => (
                        <ProfileRow key={profile.id} profile={profile} />
                    ))}

                    {tab === 'alignments' && (alignments || []).map((alignment) => (
                        <AlignmentRow key={alignment.id} alignment={alignment} />
                    ))}

                    {tab === 'alignments' && alignments && alignments.length > 0 && (
                        <div style={{ ...labelStyle, textTransform: 'none', padding: '10px 0', lineHeight: 1.5 }}>
                            Coverage is proposed, not yet part of the Semantic Treehouse catalogue export (&amp;50).
                            Alignments are followed one hop only: coverage does not compose.
                        </div>
                    )}

                    {profiles && ((tab === 'profiles' && profiles.length === 0) || (tab === 'alignments' && alignments.length === 0)) && (
                        <div style={{ ...labelStyle, textTransform: 'none', padding: '14px 0' }}>
                            The hub is empty. No loaded scenario declares a catalogue export.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default VocabularyHubDialog;
