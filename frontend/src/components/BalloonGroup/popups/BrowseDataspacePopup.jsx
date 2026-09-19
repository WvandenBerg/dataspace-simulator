import React, { useState, useRef } from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import { Search, X, GripHorizontal, ArrowLeft, Package, Settings2, Download, MapPin, Building, Eye, ChevronUp, ChevronDown, AlertCircle, ArrowRight } from 'lucide-react';
import { DOMAIN_OPTIONS } from '../constants';

const API_BASE = '/api';

const SEMANTIC_DCAT_OPTIONS = [
    { key: 'dcat:keyword', label: 'Keywords' },
    { key: 'dcat:theme', label: 'Themes' },
    { key: 'dct:spatial', label: 'Spatial / Region' },
    { key: 'dct:temporal', label: 'Temporal' },
    { key: 'dct:language', label: 'Language' },
    { key: 'dct:format', label: 'Format' },
    { key: 'dct:license', label: 'License' },
    { key: 'dct:creator', label: 'Creator' },
    { key: 'dct:conformsTo', label: 'Conforms To' },
    { key: 'dct:accrualPeriodicity', label: 'Update Frequency' },
    { key: 'dcat:landingPage', label: 'Landing Page' },
    { key: 'dcat:contactPoint', label: 'Contact Point' },
    { key: 'mobilitydcatap:mobilityTheme', label: 'Mobility Theme' },
    { key: 'mobilitydcatap:transportMode', label: 'Transport Mode' },
    { key: 'mobilitydcatap:networkCoverage', label: 'Network Coverage' },
    { key: 'mobilitydcatap:georeferencingMethod', label: 'Georeferencing Method' },
    { key: 'mobilitydcatap:intendedInformationService', label: 'Intended Information Service' },
];

const BrowseDataspacePopup = ({
    show,
    balloonX,
    viewScale,
    onClose,
    allNodes,
    currentNodeId,
    negotiationState,
    negotiationStatusText,
    negotiationProtocolState,
    currentNegotiatingAsset,
    selectedProvider,
    providerAssets,
    isLoadingCatalog,
    isSearchingLocal,
    searchResults,
    filters,
    showFilters,
    cachedSearchResultsRef,
    setSearchResults,
    setFilters,
    setShowFilters,
    onSearch,
    onViewProviderCatalog,
    onDiscoveryPulse = () => {},
    onLocalSearchChange = () => {},
    setControlPlaneGlow = () => {},
    setRingLight = () => {},
    onBackToProviders,
    onStartNegotiation,
    onStartTransfer
}) => {
    const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
    const dragStartRef = useRef({ x: 0, y: 0 });
    const isDraggingRef = useRef(false);

    // Semantic search state
    const [activeTab, setActiveTab] = useState('browse');
    const [semanticQuery, setSemanticQuery] = useState('');
    const [semanticFieldKey, setSemanticFieldKey] = useState('dcat:keyword');
    const [semanticFieldValue, setSemanticFieldValue] = useState('');
    const [semanticFieldFilters, setSemanticFieldFilters] = useState([]);
    const [semanticResults, setSemanticResults] = useState(null);
    const [semanticLoading, setSemanticLoading] = useState(false);
    const [semanticError, setSemanticError] = useState(null);
    const [semanticStatusText, setSemanticStatusText] = useState('');
    const [hiddenOwnResults, setHiddenOwnResults] = useState(0);
    const [expandedResult, setExpandedResult] = useState(null);
    const [semanticPhase, setSemanticPhase] = useState('idle');
    const [semanticProgress, setSemanticProgress] = useState({
        totalProviders: 0,
        completedProviders: 0,
        activeProviders: 0
    });

    const dataspaceId = String(allNodes?.[currentNodeId]?.dataspaceId || 'demo');

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const getProtocolStateColor = (state) => {
        if (state === 'AGREED') return '#16a34a';
        if (state === 'TERMINATED') return '#dc2626';
        if (state === 'OFFERED') return '#d97706';
        if (state === 'REQUESTED') return '#2563eb';
        return '#64748b';
    };

    const getConnectedProviderIds = () => {
        return Object.entries(allNodes)
            .filter(([id, node]) => {
                if (id === currentNodeId) return false;
                const dist = Math.sqrt((node.x || 0) * (node.x || 0) + (node.y || 0) * (node.y || 0));
                const targetRadius = 550 + 60;
                const isConnected = Math.abs(dist - targetRadius) < 20;
                return isConnected && Boolean(node.roles?.provider);
            })
            .map(([id]) => id);
    };

    const handleSemanticSearch = async () => {
        const hasFreeText = semanticQuery.trim().length > 0;
        const hasPendingFieldFilter = semanticFieldValue.trim().length > 0;
        const hasFilter = semanticFieldFilters.length > 0 || hasPendingFieldFilter;
        if (!hasFreeText && !hasFilter) return;
        setSemanticLoading(true); setSemanticError(null); setSemanticResults(null); setHiddenOwnResults(0);
        try {
            const fieldFilters = hasPendingFieldFilter
                ? [...semanticFieldFilters, { key: semanticFieldKey, value: semanticFieldValue.trim() }]
                : semanticFieldFilters;
            if (hasPendingFieldFilter) {
                setSemanticFieldFilters(fieldFilters);
                setSemanticFieldValue('');
            }

            const providerIds = getConnectedProviderIds();
            setSemanticProgress({ totalProviders: providerIds.length, completedProviders: 0, activeProviders: 0 });

            setSemanticPhase('discovering');
            setSemanticStatusText('Discovering participants...');
            onLocalSearchChange('toConnector');
            await sleep(1500);
            onDiscoveryPulse(true);
            setControlPlaneGlow(providerIds.map(nodeId => ({ nodeId, intensity: 1, type: 'controlPlane' })));
            await sleep(1400);
            onDiscoveryPulse(false);
            setControlPlaneGlow(null);
            onLocalSearchChange('toUI');
            await sleep(1500);
            onLocalSearchChange(false);
            await sleep(250);

            setSemanticPhase('collecting');
            setSemanticStatusText(`Collecting catalogs... 0/${providerIds.length}`);
            const ringMap = new Map();
            const emitRing = () => setRingLight(Array.from(ringMap.values()));
            const STAGGER_MS = 220;
            const BUILD_MS = 1650;
            const ESTABLISHED_MS = 700;
            const RETURN_MS = 1650;

            await Promise.all(providerIds.map(async (providerId, index) => {
                await sleep(index * STAGGER_MS);

                ringMap.set(providerId, { fromNodeId: currentNodeId, toNodeId: providerId, building: true });
                emitRing();
                setSemanticProgress((prev) => ({ ...prev, activeProviders: prev.activeProviders + 1 }));

                await sleep(BUILD_MS);
                ringMap.set(providerId, { fromNodeId: currentNodeId, toNodeId: providerId, established: true });
                emitRing();

                await sleep(ESTABLISHED_MS);
                await fetch(`${API_BASE}/catalog?dataspaceId=${encodeURIComponent(dataspaceId)}&consumerNodeId=${encodeURIComponent(currentNodeId)}&providerNodeId=${encodeURIComponent(providerId)}`);

                ringMap.set(providerId, { fromNodeId: currentNodeId, toNodeId: providerId, returning: true });
                emitRing();

                await sleep(RETURN_MS);
                ringMap.delete(providerId);
                emitRing();

                setSemanticProgress((prev) => {
                    const nextCompleted = prev.completedProviders + 1;
                    const nextActive = Math.max(0, prev.activeProviders - 1);
                    setSemanticStatusText(`Collecting catalogs... ${nextCompleted}/${prev.totalProviders} (active ${nextActive})`);
                    return {
                        ...prev,
                        completedProviders: nextCompleted,
                        activeProviders: nextActive,
                    };
                });
            }));

            setSemanticProgress((prev) => ({ ...prev, completedProviders: prev.totalProviders, activeProviders: 0 }));
            setRingLight(null);

            setSemanticPhase('querying');
            setSemanticStatusText('Running SPARQL query...');
            const res = await fetch(`${API_BASE}/semantic/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    searchText: semanticQuery,
                    dataspaceId,
                    consumerNodeId: currentNodeId,
                    providerNodeIds: providerIds,
                    dcatFieldFilters: fieldFilters,
                    limit: 30
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Search failed');
            const all = Array.isArray(data.results) ? data.results : [];
            const filtered = all.filter((r) => {
                const publisherNodeId = String(r.publisherNodeId || '').toLowerCase();
                return publisherNodeId !== String(currentNodeId || '').toLowerCase();
            });
            setHiddenOwnResults(Math.max(0, all.length - filtered.length));
            setSemanticPhase('rendering');
            setSemanticStatusText('Preparing results...');
            await sleep(260);
            setSemanticResults(filtered);
        } catch (e) {
            setSemanticError(e.message || 'Search failed');
        } finally {
            setRingLight(null);
            onDiscoveryPulse(false);
            setControlPlaneGlow(null);
            onLocalSearchChange(false);
            setSemanticPhase('idle');
            setSemanticLoading(false);
            setSemanticStatusText('');
        }
    };

    const addSemanticFieldFilter = () => {
        const value = semanticFieldValue.trim();
        if (!semanticFieldKey || !value) return;
        setSemanticFieldFilters((prev) => [...prev, { key: semanticFieldKey, value }]);
        setSemanticFieldValue('');
    };

    const resetFilters = () => {
        setFilters({ location: '', domain: '', ontologies: [] });
    };

    const handleBrowseClick = () => {
        const popupWidth = 320;
        const popupHeight = 400;
        const spawnX = balloonX > 0 ? -popupWidth - 30 : 320;
        const spawnY = -popupHeight / 4;
        setPopupPosition({ x: spawnX, y: spawnY });
        if (cachedSearchResultsRef.current !== null) {
            setSearchResults(cachedSearchResultsRef.current);
        }
    };

    React.useEffect(() => {
        if (show) handleBrowseClick();
    }, [show]);

    if (!show) return null;

    return (
        <Motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1, x: popupPosition.x, y: popupPosition.y }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
                position: 'absolute', left: 0, top: 0, width: '320px',
                background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                borderRadius: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
                zIndex: 100, overflowX: 'hidden', overflowY: 'hidden'
            }}
        >
            {/* Drag Header */}
            <div
                onPointerDown={(e) => {
                    e.stopPropagation();
                    isDraggingRef.current = true;
                    dragStartRef.current = { x: e.clientX, y: e.clientY };
                    e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                    if (!isDraggingRef.current) return;
                    const dx = (e.clientX - dragStartRef.current.x) / viewScale;
                    const dy = (e.clientY - dragStartRef.current.y) / viewScale;
                    dragStartRef.current = { x: e.clientX, y: e.clientY };
                    setPopupPosition(prev => ({ x: prev.x + dx, y: prev.y + dy }));
                }}
                onPointerUp={(e) => {
                    isDraggingRef.current = false;
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                style={{
                    padding: '10px 14px', borderBottom: '1px solid var(--border-color)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(59, 130, 246, 0.1)', cursor: 'grab', userSelect: 'none'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <GripHorizontal size={14} color="#64748b" style={{ marginRight: '4px' }} />
                    <Search size={16} color="#3b82f6" />
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.9rem' }}>Browse Dataspace</span>
                </div>
                <button
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClose(); onBackToProviders(); }}
                    onPointerDown={(e) => { e.stopPropagation(); isDraggingRef.current = false; }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                    <X size={16} />
                </button>
            </div>

            {/* Tab strip — only when not inside a provider view */}
            {!selectedProvider && (
                <div style={{ display: 'flex', gap: '4px', padding: '8px 10px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
                    {[
                        { id: 'browse', icon: <Search size={12} />, label: 'Browse' },
                        { id: 'semantic', icon: <Search size={12} />, label: 'Semantic Search' }
                    ].map(t => (
                        <button
                            key={t.id}
                            onClick={(e) => { e.stopPropagation(); setActiveTab(t.id); }}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                                padding: '5px 6px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                                fontSize: '0.72rem', fontWeight: activeTab === t.id ? 600 : 400,
                                background: activeTab === t.id
                                    ? 'rgba(15,23,42,0.85)'
                                    : 'transparent',
                                color: activeTab === t.id
                                    ? '#e2e8f0'
                                    : 'var(--text-muted)'
                            }}
                        >
                            {t.icon}{t.label}
                        </button>
                    ))}
                </div>
            )}

            {/* ─────────────── PROVIDER VIEW ─────────────── */}
            {selectedProvider && (
                <div onWheel={(e) => e.stopPropagation()} style={{ padding: '12px 14px', maxHeight: '440px', overflow: 'auto' }}>
                    {negotiationState !== 'idle' ? (
                        <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: negotiationState === 'connecting' ? '#3b82f6' : '#60a5fa', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                <Settings2 size={18} className={['negotiating', 'transferring', 'connecting'].includes(negotiationState) ? 'spin-slow' : ''} />
                                {negotiationState === 'connecting' ? 'Connecting...' : negotiationState === 'success' ? 'Contract Signed' : negotiationState === 'transferring' ? 'Transferring...' : 'Negotiating'}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginBottom: '16px', fontFamily: 'monospace', background: 'var(--bg-surface)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                                {negotiationStatusText || 'Processing...'}
                            </div>
                            {negotiationProtocolState && (
                                <div style={{ marginBottom: '12px', fontSize: '0.7rem', fontWeight: 700, color: getProtocolStateColor(negotiationProtocolState), border: `1px solid ${getProtocolStateColor(negotiationProtocolState)}55`, background: `${getProtocolStateColor(negotiationProtocolState)}22`, borderRadius: '999px', padding: '4px 10px', display: 'inline-block' }}>
                                    State: {negotiationProtocolState}
                                </div>
                            )}
                            {currentNegotiatingAsset && (
                                <div style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '10px', marginBottom: '12px', border: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '4px' }}>Asset</div>
                                    <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{currentNegotiatingAsset.name}</div>
                                </div>
                            )}
                            {negotiationState === 'success' && (
                                <Motion.button
                                    initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                                    onClick={(e) => { e.stopPropagation(); onStartTransfer(); }}
                                    style={{ width: '100%', padding: '10px', background: '#22c55e', border: 'none', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 0 20px rgba(34,197,94,0.5)' }}
                                >
                                    <Download size={16} /> Download Asset
                                </Motion.button>
                            )}
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={(e) => { e.stopPropagation(); onBackToProviders(); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', marginBottom: '12px', background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                                <ArrowLeft size={14} /> Back
                            </button>
                            <div style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '10px', marginBottom: '12px', border: '1px solid var(--border-subtle)' }}>
                                <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.9rem' }}>{selectedProvider.name}</div>
                                <div style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>{selectedProvider.bpn}</div>
                            </div>
                            {isLoadingCatalog ? (
                                <div style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>
                                    <Motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-block' }}>
                                        <Package size={20} />
                                    </Motion.div>
                                    <div style={{ marginTop: '8px', fontSize: '0.8rem' }}>Loading Catalog...</div>
                                </div>
                            ) : providerAssets.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '0.85rem' }}>
                                    <Package size={32} style={{ opacity: 0.4, marginBottom: '8px' }} />
                                    <div>No assets available</div>
                                </div>
                            ) : (
                                <div>
                                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '8px' }}>{providerAssets.length} Asset(s) available</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {providerAssets.map((asset) => (
                                            <Motion.div key={asset.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '10px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                                                    <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.8rem' }}>{asset.name}</div>
                                                    <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.6rem', background: 'rgba(59,130,246,0.2)', color: '#93c5fd' }}>{asset.type}</span>
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '8px' }}>{asset.description}</div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onStartNegotiation(asset, selectedProvider); }}
                                                    style={{ width: '100%', padding: '6px', background: 'rgba(34,197,94,0.2)', border: '1px solid #16a34a', borderRadius: '4px', color: '#15803d', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}
                                                >
                                                    Request Contract
                                                </button>
                                            </Motion.div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* ─────────────── BROWSE TAB ─────────────── */}
            {!selectedProvider && activeTab === 'browse' && (
                <div onWheel={(e) => e.stopPropagation()} style={{ padding: '12px 14px', maxHeight: '400px', overflow: 'auto' }}>
                    <button
                        onClick={(e) => { e.stopPropagation(); onSearch(); }}
                        disabled={isSearchingLocal}
                        style={{ width: '100%', padding: '10px', marginBottom: '12px', background: isSearchingLocal ? '#1e40af' : '#3b82f6', border: 'none', borderRadius: '6px', color: 'white', cursor: isSearchingLocal ? 'wait' : 'pointer', fontSize: '0.85rem', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                        {isSearchingLocal ? (
                            <><Motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Search size={14} /></Motion.div>Searching...</>
                        ) : (
                            <><Search size={14} />Search Providers</>
                        )}
                    </button>

                    {searchResults !== null && (
                        <div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '8px' }}>{searchResults.length} Provider(s) found</div>
                            {searchResults.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '20px', color: '#64748b', fontSize: '0.8rem' }}>No Providers found</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {searchResults.map((provider) => (
                                        <Motion.div key={provider.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '10px', cursor: 'pointer' }} whileHover={{ borderColor: '#3b82f6' }}>
                                            <div style={{ marginBottom: '6px' }}>
                                                <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{provider.name}</div>
                                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontFamily: 'monospace' }}>{provider.bpn}</div>
                                            </div>
                                            {provider.location && <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '6px' }}><MapPin size={10} />{provider.location}</div>}
                                            {provider.domain && <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '8px' }}><Building size={10} />{provider.domain}</div>}
                                            <button onClick={(e) => { e.stopPropagation(); onViewProviderCatalog(provider); }} style={{ width: '100%', padding: '6px', background: 'rgba(249,115,22,0.15)', border: '1px solid #f97316', borderRadius: '4px', color: '#fb923c', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                                <Eye size={12} /> View Catalog
                                            </button>
                                        </Motion.div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ─────────────── SEMANTIC SEARCH TAB ─────────────── */}
            {!selectedProvider && activeTab === 'semantic' && (
                <div onWheel={(e) => e.stopPropagation()} style={{ padding: '12px 14px', maxHeight: '440px', overflow: 'auto' }}>
                    {negotiationState !== 'idle' && (
                        <div style={{ marginBottom: '10px', padding: '8px', border: '1px solid var(--border-subtle)', borderRadius: '7px', background: 'var(--bg-card)' }}>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-primary)', marginBottom: '4px', fontWeight: 600 }}>
                                {negotiationStatusText || 'Processing contract request...'}
                            </div>
                            {negotiationProtocolState && (
                                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: getProtocolStateColor(negotiationProtocolState) }}>
                                    State: {negotiationProtocolState}
                                </div>
                            )}
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                        <input
                            type="text" value={semanticQuery}
                            onChange={e => setSemanticQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSemanticSearch(); e.stopPropagation(); }}
                            onClick={e => e.stopPropagation()}
                            placeholder="e.g. BIM data Munich, concrete delivery..."
                            style={{ flex: 1, padding: '7px 10px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                        />
                        <button
                            onClick={(e) => { e.stopPropagation(); handleSemanticSearch(); }}
                            disabled={semanticLoading || (!semanticQuery.trim() && semanticFieldFilters.length === 0 && !semanticFieldValue.trim())}
                            style={{ padding: '7px 12px', background: semanticLoading ? '#1d4ed8' : '#2563eb', border: 'none', borderRadius: '6px', color: '#f8fafc', cursor: semanticLoading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', fontWeight: 600 }}
                        >
                            {semanticLoading ? '...' : 'Go'}
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) auto', gap: '6px', marginBottom: '8px' }}>
                        <select
                            value={semanticFieldKey}
                            onChange={(e) => setSemanticFieldKey(e.target.value)}
                            style={{ minWidth: 0, padding: '7px 8px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.74rem' }}
                        >
                            {SEMANTIC_DCAT_OPTIONS.map((o) => (
                                <option key={o.key} value={o.key}>{o.label}</option>
                            ))}
                        </select>
                        <input
                            type="text"
                            value={semanticFieldValue}
                            onChange={(e) => setSemanticFieldValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addSemanticFieldFilter();
                                }
                            }}
                            placeholder="Filter value"
                            style={{ minWidth: 0, padding: '7px 8px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.74rem' }}
                        />
                        <button
                            onClick={addSemanticFieldFilter}
                            style={{ padding: '7px 9px', background: '#334155', border: '1px solid #475569', borderRadius: '6px', color: '#e2e8f0', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600 }}
                        >
                            Add
                        </button>
                    </div>

                    {semanticFieldFilters.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px', minWidth: 0 }}>
                            {semanticFieldFilters.map((f, i) => {
                                const label = SEMANTIC_DCAT_OPTIONS.find(o => o.key === f.key)?.label || f.key;
                                return (
                                    <button
                                        key={`${f.key}-${i}`}
                                        onClick={() => setSemanticFieldFilters(prev => prev.filter((_, idx) => idx !== i))}
                                        style={{ maxWidth: '100%', padding: '3px 8px', borderRadius: '999px', border: '1px solid #475569', background: '#0f172a', color: '#cbd5e1', fontSize: '0.7rem', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                        title="Remove filter"
                                    >
                                        {label}: {f.value} x
                                    </button>
                                );
                            })}
                            <button
                                onClick={() => setSemanticFieldFilters([])}
                                style={{ padding: '3px 8px', borderRadius: '999px', border: '1px solid #475569', background: 'transparent', color: '#94a3b8', fontSize: '0.7rem', cursor: 'pointer' }}
                            >
                                Clear
                            </button>
                        </div>
                    )}

                    {semanticLoading && (
                        <div style={{ marginBottom: '10px', padding: '8px', border: '1px solid #334155', borderRadius: '7px', background: '#0f172a', color: '#f8fafc', fontSize: '0.74rem', fontWeight: 600, minHeight: '18px' }}>
                            {semanticStatusText || 'Searching...'}
                        </div>
                    )}

                    {semanticError && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: '6px', marginBottom: '10px', color: '#ef4444', fontSize: '0.78rem' }}>
                            <AlertCircle size={12} />{semanticError}
                        </div>
                    )}

                    {semanticResults === null && !semanticLoading && (
                        <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b' }}>
                            <div style={{ fontSize: '0.8rem' }}>Enter a query or add DCAT filters</div>
                        </div>
                    )}

                    {semanticResults !== null && semanticResults.length === 0 && !semanticLoading && !semanticError && (
                        <div style={{ textAlign: 'center', padding: '30px 10px', color: '#64748b', fontSize: '0.8rem' }}>
                            {hiddenOwnResults > 0 ? 'Only your own assets matched. Own assets are hidden in semantic results.' : 'No matching assets found'}
                        </div>
                    )}

                    {semanticResults && semanticResults.length > 0 && (
                        <>
                            <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '8px' }}>{semanticResults.length} asset(s) found</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {semanticResults.map((result, i) => {
                                    const key = result.datasetId || `r${i}`;
                                    const isExpanded = expandedResult === key;
                                    return (
                                        <Motion.div key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} style={{ background: 'var(--bg-card)', border: `1px solid ${isExpanded ? '#2563eb' : 'var(--border-subtle)'}`, borderRadius: '8px', overflow: 'hidden' }}>
                                            <div onClick={() => setExpandedResult(isExpanded ? null : key)} style={{ padding: '10px', cursor: 'pointer' }}>
                                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.82rem', marginBottom: '2px' }}>{result.title || result.datasetId}</div>
                                                {result.description && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>{result.description.substring(0, 70)}{result.description.length > 70 ? '…' : ''}</div>}
                                                <div style={{ fontSize: '0.68rem', color: '#64748b' }}>by {result.publisherName || result.publisherNodeId || 'Unknown'}</div>
                                            </div>
                                            {isExpanded && (
                                                <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '10px', background: 'rgba(37,99,235,0.08)' }}>
                                                    {result.keywords && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}><strong>Keywords:</strong> {result.keywords}</div>}
                                                    {result.themes && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}><strong>Themes:</strong> {result.themes}</div>}
                                                    {result.spatial && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}><strong>Region:</strong> {Array.isArray(result.spatial) ? result.spatial.join(', ') : result.spatial}</div>}
                                                    {result.temporalCoverage && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '10px' }}><strong>Period:</strong> {result.temporalCoverage}</div>}
                                                    <button onClick={() => {
                                                        const providerId = result.publisherNodeId || result.publisherBpn;
                                                        if (!providerId) return;
                                                        const provider = { id: providerId, bpn: result.publisherBpn || providerId, name: result.publisherName || providerId };
                                                        const asset = {
                                                            id: result.datasetId,
                                                            sourceId: result.datasetId,
                                                            name: result.title || result.datasetId,
                                                            description: result.description || '',
                                                            keywords: result.keywords || [],
                                                            themes: result.themes || [],
                                                            spatial: result.spatial || [],
                                                        };
                                                        onStartNegotiation(asset, provider, { autoTransfer: true });
                                                    }} style={{ width: '100%', padding: '6px', background: '#1d4ed8', border: '1px solid #2563eb', borderRadius: '5px', color: '#ffffff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                                                        <ArrowRight size={11} /> Request Contract
                                                    </button>
                                                </div>
                                            )}
                                        </Motion.div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            )}
        </Motion.div>
    );
};

export default BrowseDataspacePopup;
