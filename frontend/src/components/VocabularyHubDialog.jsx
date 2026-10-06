import React, { useEffect, useRef, useState } from 'react';
import { X, Link2, Unlink, ArrowRight } from 'lucide-react';
import CatalogProfilesTab from './CatalogProfilesTab';
import ValidationTab from './ValidationTab';

const API_BASE = '/api';

const labelStyle = { fontSize: '0.64rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const publisherStyle = { fontSize: '0.68rem', color: 'var(--text-muted)' };
const uriStyle = { fontSize: '0.66rem', color: 'var(--color-primary)', fontFamily: 'monospace', wordBreak: 'break-all' };

const ProfileRow = ({ profile, focused = false }) => {
    const [open, setOpen] = useState(focused);
    const rowRef = useRef(null);

    useEffect(() => {
        if (focused) rowRef.current?.scrollIntoView({ block: 'nearest' });
    }, [focused]);

    return (
        <div ref={rowRef} style={{ borderBottom: '1px solid var(--border-color)', padding: '8px 6px', background: focused ? 'rgba(22, 163, 74, 0.08)' : 'transparent' }}>
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

const DisconnectedNotice = ({ children }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', margin: '8px 0 4px', padding: '7px 10px', borderRadius: '7px', fontSize: '0.74rem', background: 'rgba(217, 119, 6, 0.12)', color: '#b45309' }}>
        <Unlink size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
        <span>{children}</span>
    </div>
);

const VocabularyHubDialog = ({ dataspaceId, isConnected, focusProfileId = null, initialTab = 'profiles', validation = null, onCatalogChange, onClose }) => {
    const [tab, setTab] = useState(initialTab);
    const [profiles, setProfiles] = useState(null);
    const [alignments, setAlignments] = useState(null);
    const [catalogCount, setCatalogCount] = useState(null);
    const [hubVersion, setHubVersion] = useState(0);
    const [error, setError] = useState(null);

    useEffect(() => {
        const query = `?dataspaceId=${encodeURIComponent(dataspaceId)}`;
        Promise.all([
            fetch(`${API_BASE}/vocabhub/profiles${query}`).then((r) => r.json()),
            fetch(`${API_BASE}/vocabhub/alignments${query}`).then((r) => r.json()),
        ])
            .then(([p, a]) => { setProfiles(p); setAlignments(a); })
            .catch(() => setError('Vocabulary Hub unavailable'));
    }, [dataspaceId, hubVersion]);

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
            onWheel={(e) => e.stopPropagation()}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100 }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: tab === 'catalog' || tab === 'validation' ? '680px' : '560px', maxWidth: '94vw', maxHeight: '76vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-elevated)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px 18px' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#14532d', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src="/assets/sth-logo.svg" alt="" style={{ width: '20px', height: '20px' }} />
                    </div>
                    <div style={{ flex: 1, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>Vocabulary Hub</div>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', fontWeight: 600, color: isConnected ? '#15803d' : 'var(--text-muted)' }}>
                        {isConnected ? <Link2 size={12} /> : <Unlink size={12} />}
                        {isConnected ? 'Connected' : 'Not connected'}
                    </span>
                    <X size={18} style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={onClose} />
                </div>

                <div style={{ display: 'flex', gap: '4px', marginTop: '12px', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={tabStyle('profiles')} onClick={() => setTab('profiles')}>
                        Profiles{profiles ? ` (${profiles.length})` : ''}
                    </div>
                    <div style={tabStyle('alignments')} onClick={() => setTab('alignments')}>
                        Alignments{alignments ? ` (${alignments.length})` : ''}
                    </div>
                    <div style={tabStyle('catalog')} onClick={() => setTab('catalog')}>
                        Catalog profiles{catalogCount !== null ? ` (${catalogCount})` : ''}
                    </div>
                    {validation && (
                        <div style={tabStyle('validation')} onClick={() => setTab('validation')}>
                            Validation{validation.report ? ` (${validation.report.total - validation.report.violations}/${validation.report.total})` : ''}
                        </div>
                    )}
                </div>

                <div style={{ overflowY: 'auto', marginTop: '4px' }}>
                    {tab === 'validation' && validation && <ValidationTab dataspaceId={dataspaceId} validation={validation} />}

                    {tab === 'catalog' && (
                        <CatalogProfilesTab
                            dataspaceId={dataspaceId}
                            onCountChange={setCatalogCount}
                            onChange={() => {
                                setHubVersion((v) => v + 1);
                                onCatalogChange?.();
                            }}
                        />
                    )}

                    {error && <div style={{ fontSize: '0.78rem', color: '#b45309', padding: '10px 0' }}>{error}</div>}
                    {(tab === 'profiles' || tab === 'alignments') && !error && !profiles && <div style={{ ...labelStyle, padding: '10px 0' }}>Loading...</div>}

                    {!isConnected && tab === 'profiles' && (
                        <DisconnectedNotice>
                            Participants cannot look these standards up from search results or offer them as a
                            data-standard filter. Drag the hub onto the ring to make them available.
                        </DisconnectedNotice>
                    )}
                    {!isConnected && tab === 'alignments' && (
                        <DisconnectedNotice>
                            Searches do not widen along these alignments. Drag the hub onto the ring to use them.
                        </DisconnectedNotice>
                    )}

                    {tab === 'profiles' && (profiles || []).map((profile) => (
                        <ProfileRow key={profile.id} profile={profile} focused={profile.id === focusProfileId} />
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
                            The hub is empty. No loaded scenario declares a catalogue export, and nothing was uploaded.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default VocabularyHubDialog;
