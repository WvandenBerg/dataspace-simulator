import React, { useState } from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import { FileText, MoreVertical } from 'lucide-react';
import { useContractNegotiation } from './hooks/useContractNegotiation';
import DeleteConfirmDialog from './dialogs/DeleteConfirmDialog';
import EditParticipantDialog from './dialogs/EditParticipantDialog';
import ParticipantDropdownMenu from './menus/ParticipantDropdownMenu';
import DataStorageSection from './sections/DataStorageSection';
import BrowseDataspacePopup from './popups/BrowseDataspacePopup';

const BalloonGroup = ({
    balloonX,
    balloonY,
    name,
    bpn,
    isConnected,
    onEdit,
    onDelete,
    catalog = [],
    logs = [],
    viewScale = 0.4,
    participantData = {},
    allNodes = {},
    currentNodeId = null,
    onDiscoveryPulse = () => { },
    onRequestContract = () => { },
    onLocalSearchChange = () => { },
    setControlPlaneGlow = () => { },
    setRingLight = () => { },
    setDataPlaneConnection = () => { },
    setDataTransfer = () => { },
    assets = [],
    onDeleteAsset = () => { },
    onAddAsset = () => { },
    onEditAsset = () => { },
    onAction,
    isDemo = true,
    minimalView = false
}) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [showBrowsePopup, setShowBrowsePopup] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [searchResults, setSearchResults] = useState(null);
    const [filters, setFilters] = useState({
        location: '',
        domain: '',
        ontologies: []
    });

    const {
        isSearchingLocal,
        selectedProvider,
        providerAssets,
        isLoadingCatalog,
        negotiationState,
        negotiationStatusText,
        negotiationProtocolState,
        currentNegotiatingAsset,
        cachedSearchResultsRef,
        handleSearch: hookHandleSearch,
        handleViewProviderCatalog,
        handleBackToProviders,
        startNegotiation,
        startTransfer
    } = useContractNegotiation({
        currentNodeId,
        allNodes,
        onLocalSearchChange,
        setControlPlaneGlow,
        setRingLight,
        setDataPlaneConnection,
        setDataTransfer,
        onDiscoveryPulse,
        onAddAsset,
        onRequestContract
    });

    const handleMenuToggle = (e) => {
        e.stopPropagation();
        setMenuOpen(!menuOpen);
    };

    const handleEditClick = (e) => {
        e.stopPropagation();
        setShowEditDialog(true);
        setMenuOpen(false);
    };

    const handleDeleteClick = (e) => {
        e.stopPropagation();
        setShowDeleteConfirm(true);
        setMenuOpen(false);
    };

    const handleConfirmDelete = () => {
        if (onDelete) onDelete();
        setShowDeleteConfirm(false);
    };

    const handleBrowseClick = (e) => {
        e.stopPropagation();
        setShowBrowsePopup(true);
        if (cachedSearchResultsRef.current !== null) {
            setSearchResults(cachedSearchResultsRef.current);
        }
    };

    const handleSaveEdit = (editForm) => {
        if (onEdit) onEdit(editForm);
        setShowEditDialog(false);
    };

    const handleSearch = () => {
        hookHandleSearch(filters, setSearchResults);
    };

    return (
        <Motion.div
            className="schematic-balloon-group"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
                position: 'absolute',
                x: balloonX,
                y: balloonY,
                translateX: '-50%',
                translateY: '-50%',
                width: minimalView ? 200 : 300,
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                zIndex: 2
            }}
        >
            <div
                className="schematic-unified-box"
                style={{
                    position: 'relative',
                    width: '100%',
                    minWidth: minimalView ? '180px' : '200px',
                    background: 'var(--bg-card)',
                    border: '2px solid var(--border-subtle)',
                    borderRadius: '12px',
                    padding: minimalView ? '0.75rem' : '1rem',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.25)'
                }}
            >
                {!minimalView && (
                    <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 20 }}>
                        <button
                            onClick={handleMenuToggle}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--text-muted)',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => e.target.style.background = 'rgba(255,255,255,0.1)'}
                            onMouseLeave={(e) => e.target.style.background = 'transparent'}
                        >
                            <MoreVertical size={16} />
                        </button>

                        <ParticipantDropdownMenu
                            show={menuOpen}
                            onEdit={handleEditClick}
                            onDelete={handleDeleteClick}
                            isDemo={isDemo}
                        />
                    </div>
                )}

                {!minimalView && (
                    <>
                        <div
                            className="schematic-header"
                            style={{
                                borderBottom: '1px solid var(--border-subtle)',
                                paddingBottom: '0.5rem',
                                marginBottom: '0.5rem',
                                paddingRight: '24px'
                            }}
                        >
                            <div style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--text-primary)' }}>{name}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>{bpn}</div>
                        </div>

                        <div className="schematic-content">
                            {isDemo && !minimalView && (
                                <div style={{ marginBottom: '0.5rem' }}>
                                    <button
                                        className="schematic-btn"
                                        onClick={handleBrowseClick}
                                        disabled={!isConnected}
                                        style={{
                                            width: '100%',
                                            padding: '0.5rem',
                                            background: '#3b82f6',
                                            border: 'none',
                                            borderRadius: '6px',
                                            color: 'white',
                                            cursor: 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: '600'
                                        }}
                                    >
                                        Browse Dataspace
                                    </button>
                                </div>
                            )}

                            {catalog.length > 0 && (
                                <div className="schematic-list" style={{ marginTop: '0.5rem' }}>
                                    {catalog.map((item, i) => (
                                        <div
                                            key={i}
                                            className="schematic-list-item"
                                            onClick={(e) => { e.stopPropagation(); onAction('request_transfer', item); }}
                                            style={{ padding: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                                        >
                                            <FileText size={10} /> {item['name']?.substring(0, 15)}...
                                        </div>
                                    ))}
                                </div>
                            )}

                            <DataStorageSection
                                assets={assets}
                                isConnected={isConnected}
                                onPublish={() => onAction('publish_asset', null, currentNodeId)}
                                onDeleteAsset={onDeleteAsset}
                                onEditAsset={(assetId, payload) => onEditAsset(assetId, payload, currentNodeId)}
                                isDemo={isDemo}
                                minimalView={minimalView}
                            />
                        </div>
                    </>
                )}

                {minimalView && (
                    <div style={{
                        padding: '0.75rem',
                        textAlign: 'center'
                    }}>
                        <div style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--text-primary)' }}>{name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>{bpn}</div>
                    </div>
                )}
            </div>

            <DeleteConfirmDialog
                show={showDeleteConfirm}
                name={name}
                onConfirm={handleConfirmDelete}
                onCancel={() => setShowDeleteConfirm(false)}
            />

            <EditParticipantDialog
                show={showEditDialog}
                name={name}
                bpn={bpn}
                participantData={participantData}
                onSave={handleSaveEdit}
                onCancel={() => setShowEditDialog(false)}
            />

            <BrowseDataspacePopup
                show={showBrowsePopup}
                balloonX={balloonX}
                balloonY={balloonY}
                viewScale={viewScale}
                onClose={() => setShowBrowsePopup(false)}
                allNodes={allNodes}
                currentNodeId={currentNodeId}
                negotiationState={negotiationState}
                negotiationStatusText={negotiationStatusText}
                negotiationProtocolState={negotiationProtocolState}
                currentNegotiatingAsset={currentNegotiatingAsset}
                selectedProvider={selectedProvider}
                providerAssets={providerAssets}
                isLoadingCatalog={isLoadingCatalog}
                isSearchingLocal={isSearchingLocal}
                searchResults={searchResults}
                filters={filters}
                showFilters={showFilters}
                cachedSearchResultsRef={cachedSearchResultsRef}
                setSearchResults={setSearchResults}
                setFilters={setFilters}
                setShowFilters={setShowFilters}

                onSearch={handleSearch}
                onViewProviderCatalog={handleViewProviderCatalog}
                onDiscoveryPulse={onDiscoveryPulse}
                onLocalSearchChange={onLocalSearchChange}
                setControlPlaneGlow={setControlPlaneGlow}
                setRingLight={setRingLight}
                onBackToProviders={handleBackToProviders}
                onStartNegotiation={startNegotiation}
                onStartTransfer={startTransfer}
            />
        </Motion.div>
    );
};

export default BalloonGroup;
