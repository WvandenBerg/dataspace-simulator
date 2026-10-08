import React, { useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import ConnectorNode from './ConnectorNode';
import DataspaceCircle from './DataspaceCircle';
import TransferBeam from './TransferBeam';
import DataPlaneBeam from './DataPlaneBeam';
import ControlPlaneBeam from './ControlPlaneBeam';
import ZoomOutButton from './ZoomOutButton';
import ZoomControls from './ZoomControls';
import DataspaceServicesPanel from './DataspaceServicesPanel';
import VocabularyHubNode from './VocabularyHubNode';
import VocabularyHubDialog from './VocabularyHubDialog';
import { OpenHubProfileContext, ValidationReportContext } from './VocabularyHubContext';
import { useViewState } from './hooks/useViewState';
import { useDragNodes } from './hooks/useDragNodes';
import { useVocabularyHub } from './hooks/useVocabularyHub';
import { useMetadataValidator } from './hooks/useMetadataValidator';
import './Components.css';

const DATASPACE_RADIUS = 550;
const CONNECTOR_OFFSET = 60;

// Schwellwerte für Zoom-basierte Interaktion
const ZOOM_THRESHOLD_FOCUS = 0.7;  // Ab diesem Scale gilt ein Node als "fokussiert"
const ZOOM_THRESHOLD_UNFOCUS = 0.5; // Below this scale, focus is released

const MacroView = forwardRef(({
    dataspaceId,
    isDemo = true,
    activeConnector,
    onConnectorClick,
    simulationState,
    onAction,
    logs,
    catalog,
    discoveryPulse,
    onDiscoveryPulse,
    controlPlaneGlow,
    setControlPlaneGlow,
    ringLight,
    setRingLight,
    dataPlaneConnection,
    setDataPlaneConnection,
    dataTransfer,
    setDataTransfer,
    onRequestContract,
    runContractAnimation,
    onContentChange,
    minimalView = false
}, ref) => {
    const containerRef = useRef(null);
    const hostedKnownNodeIdsRef = useRef(new Set());
    const hostedAppearanceTimersRef = useRef(new Map());
    const [appearingHostedNodeIds, setAppearingHostedNodeIds] = useState({});

    // Custom Hooks
    const { viewState, setViewState, handleWheel, handlePanStart, isPanning, zoomIn, zoomOut } = useViewState(0.4);

    // Zoom-basierte Fokus-Logik (ersetzt isZoomed boolean)
    const isFocused = viewState.scale > ZOOM_THRESHOLD_FOCUS;

    const ringRadius = (minimalView ? 330 : 550) + 60;

    const {
        nodes,
        setNodes,
        draggedId,
        isSnapZone,
        dragState,
        addNode,
        removeNode,
        updateNode,
        getProviders,
        filterNodes,
        handleDragStart,
        handleDrag,
        handleDragEnd
    } = useDragNodes(isFocused, dataspaceId, minimalView ? 330 : 550);

    const participantPositions = React.useMemo(() => Object.values(nodes), [nodes]);
    const vocabHub = useVocabularyHub(dataspaceId, ringRadius, participantPositions);
    const validator = useMetadataValidator(dataspaceId, vocabHub.isEnabled);
    const hubPositions = vocabHub.isEnabled && vocabHub.position ? [vocabHub.position] : [];
    const [hubDialogOpen, setHubDialogOpen] = useState(false);
    const [hubFocusProfileId, setHubFocusProfileId] = useState(null);
    const [hubDialogTab, setHubDialogTab] = useState('profiles');
    const openHubDialog = (profileId = null, tab = 'profiles') => {
        setHubFocusProfileId(profileId);
        setHubDialogTab(tab);
        setHubDialogOpen(true);
    };

    // Measured, not read from the ref while rendering: on the first render the ref is still empty,
    // and in an iframe nothing else re-renders soon enough to correct the centre.
    const [containerSize, setContainerSize] = useState(null);
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return undefined;
        const observer = new ResizeObserver(() => setContainerSize({ width: el.clientWidth, height: el.clientHeight }));
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        return () => {
            hostedAppearanceTimersRef.current.forEach((timer) => clearTimeout(timer));
            hostedAppearanceTimersRef.current.clear();
        };
    }, []);

    // Simulator is always local — no hosted-session fetching needed.

    // Edit participant credentials
    const handleEditNode = async (id, data) => {
        if (!isDemo) {
            console.log('[MacroView] Cannot edit node in hosted mode');
            return;
        }
        const patch = {
            industry: (data?.industry || '').trim().toLowerCase(),
            orgRole: (data?.orgRole || '').trim().toLowerCase(),
        };
        await updateNode(id, patch);
    };

    // Asset management state — loaded from backend SQLite, not localStorage
    const [nodeAssets, setNodeAssets] = useState({});

    useEffect(() => {
        async function loadAssets() {
            try {
                const res = await fetch(`/api/assets?dataspaceId=${encodeURIComponent(dataspaceId)}`);
                const assets = await res.json();
                const allowedNodeIds = new Set(Object.keys(nodes));
                const grouped = {};
                for (const a of assets) {
                    const id = a.ownerNodeId;
                    if (!allowedNodeIds.has(id)) continue;
                    if (!grouped[id]) grouped[id] = [];
                    grouped[id].push({
                        id: a.id,
                        name: a.name,
                        description: a.description,
                        content: a.content,
                        fileName: a.fileName,
                        policyId: a.policyId,
                        dcatFields: a.dcatFields || {},
                        ownerNodeId: id,
                        policy: a.policyId,
                        type: a.policyId || 'open',
                        publishedAt: a.publishedAt,
                    });
                }
                setNodeAssets(grouped);
            } catch (err) {
                console.error('[MacroView] Failed to load assets:', err);
            }
        }
        loadAssets();
    }, [dataspaceId, Object.keys(nodes).join('|')]);

    // Add asset — state is already updated by SimulatorPage after API call
    const handleAddAsset = (nodeId, asset) => {
        setNodeAssets(prev => ({
            ...prev,
            [nodeId]: [...(prev[nodeId] || []), { ...asset, ownerNodeId: nodeId }]
        }));
        validator.run();
        onContentChange?.();
    };

    // Delete asset — calls backend then updates local state
    const handleDeleteAsset = async (nodeId, assetId) => {
        try {
            await fetch(`/api/assets/${assetId}`, { method: 'DELETE' });
        } catch (err) {
            console.error('[MacroView] Delete asset failed:', err);
        }
        setNodeAssets(prev => ({
            ...prev,
            [nodeId]: (prev[nodeId] || []).filter(a => a.id !== assetId && a['@id'] !== assetId)
        }));
        validator.run();
        onContentChange?.();
    };

    const handleEditAsset = async (assetId, payload, nodeId) => {
        try {
            const res = await fetch(`/api/assets/${assetId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dataspaceId, asset: { ...payload, dataspaceId } }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || 'Update failed');

            const updated = data?.asset;
            if (!updated) return;

            setNodeAssets(prev => ({
                ...prev,
                [nodeId]: (prev[nodeId] || []).map(a => a.id === assetId ? {
                    ...a,
                    name: updated.name,
                    description: updated.description,
                    content: updated.content,
                    fileName: updated.fileName,
                    policyId: updated.policyId,
                    dcatFields: updated.dcatFields || {},
                    policy: updated.policyId || 'open',
                    type: updated.policyId || 'open',
                } : a)
            }));
            validator.run();
        } catch (err) {
            console.error('[MacroView] Edit asset failed:', err.message || err);
        }
    };

    // Delete Handler
    const handleDeleteNode = async (id) => {
        if (!isDemo) {
            console.log('[MacroView] Cannot delete node in hosted mode');
            return;
        }
        if (activeConnector === id) {
            onConnectorClick(null);
        }
        await removeNode(id);
        onContentChange?.();
    };

    // Remove node by BPN (for WebSocket participant_left events)
    const removeNodeByBpn = (bpn) => {
        const nodeId = Object.keys(nodes).find(id => nodes[id].bpn === bpn);
        if (nodeId) {
            console.log(`[MacroView] Removing node ${nodeId} (BPN: ${bpn})`);
            removeNode(nodeId);
        }
    };

    // Expose functions to parent
    useImperativeHandle(ref, () => ({
        addNode: async (participantData) => {
            const id = await addNode(participantData, hubPositions);
            onContentChange?.();
            return id;
        },
        getProviders,
        filterNodes,
        nodes,
        getNodeById: (id) => nodes[id],
        addAsset: handleAddAsset,
        removeNodeByBpn
    }));

    // Automatisch Fokus aufheben wenn weit genug rausgezoomt
    useEffect(() => {
        if (activeConnector && viewState.scale < ZOOM_THRESHOLD_UNFOCUS) {
            onConnectorClick(null);
        }
    }, [viewState.scale, activeConnector, onConnectorClick]);

    // Calculate View Transform - jetzt immer basierend auf viewState
    const finalX = viewState.x;
    const finalY = viewState.y;
    const finalScale = viewState.scale;
    const canvasCenterX = (containerSize?.width ?? 0) / 2;
    const canvasCenterY = (containerSize?.height ?? 0) / 2;
    const canvasX = finalX + canvasCenterX;
    const canvasY = finalY + canvasCenterY;

    const resetView = () => {
        onConnectorClick(null);
        setViewState({ x: 0, y: -100, scale: 0.4 });
    };

    // Bei Klick auf Node: Zoom zum Node (setzt viewState)
    const handleNodeClick = (id) => {
        if (id && nodes[id]) {
            const node = nodes[id];

            // Calculate angle of connector on the circle
            const angle = Math.atan2(node.y, node.x);

            // The BalloonGroup panel appears on the OUTER side of the connector
            // We need to offset the viewport in the OPPOSITE direction to show it
            // Panel is roughly 300px wide/tall, so offset ~ 150px toward center
            const panelOffset = 150;

            // Calculate offset based on angle - push viewport toward center
            const offsetX = Math.cos(angle) * panelOffset;
            const offsetY = Math.sin(angle) * panelOffset;

            const targetScale = 0.85;

            // Center the node but offset to show the BalloonGroup panel
            setViewState({
                x: -node.x * targetScale - offsetX,
                y: -node.y * targetScale - offsetY,
                scale: targetScale
            });
        }
        onConnectorClick(id);
    };

    // Glow Opacity Calculation
    const targetRadius = DATASPACE_RADIUS + CONNECTOR_OFFSET;
    const distDiff = Math.abs(dragState.distance - targetRadius);
    const maxGlowDist = 400;
    const glowOpacity = draggedId ? Math.max(0, Math.min(1, 1 - (distDiff / maxGlowDist))) : 0;

    return (
        <OpenHubProfileContext.Provider value={vocabHub.isConnected ? openHubDialog : null}>
        <ValidationReportContext.Provider value={validator.isActive ? validator.report : null}>
        <div
            className="macro-view-container"
            ref={containerRef}
            onWheel={(e) => handleWheel(e, containerRef)}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={handlePanStart}
            style={{ cursor: 'default' }}
        >
            {/* Only once measured, so the ring never paints off-centre and then slides into place. */}
            {containerSize && (
            <motion.div
                className="macro-canvas"
                initial={false}
                animate={{
                    x: canvasX,
                    y: canvasY,
                    scale: finalScale
                }}
                transition={{
                    x: isPanning ? { duration: 0 } : { duration: 0.62, ease: [0.25, 0.1, 0.25, 1] },
                    y: isPanning ? { duration: 0 } : { duration: 0.62, ease: [0.25, 0.1, 0.25, 1] },
                    scale: { duration: 0.62, ease: [0.25, 0.1, 0.25, 1] }
                }}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: 0,
                    height: 0,
                    overflow: 'visible'
                }}
            >
                {/* Dataspace Circle */}
                <DataspaceCircle
                    isSnapZone={isSnapZone}
                    glowOpacity={glowOpacity}
                    dragAngle={dragState.angle}
                    simulationState={simulationState}
                    discoveryPulse={discoveryPulse}
                    ringLight={ringLight}
                    nodes={nodes}
                    minimalView={minimalView}
                />

                {vocabHub.isEnabled && vocabHub.position && (
                    <VocabularyHubNode
                        position={vocabHub.position}
                        isConnected={vocabHub.isConnected}
                        scale={finalScale}
                        onDragStart={vocabHub.onDragStart}
                        onDrag={vocabHub.onDrag}
                        onDragEnd={vocabHub.onDragEnd}
                        onClick={() => openHubDialog()}
                        validation={validator.isActive ? validator : null}
                        onValidatorClick={() => openHubDialog(null, 'validation')}
                    />
                )}

                {/* Connectors */}
                {Object.keys(nodes).map(id => {
                    const node = nodes[id];
                    const angleRad = Math.atan2(node.y, node.x);
                    const rotation = angleRad * (180 / Math.PI);
                    const dist = Math.sqrt(node.x * node.x + node.y * node.y);
                    const targetRadius = (minimalView ? 330 : 550) + 60;
                    const isConnected = Math.abs(dist - targetRadius) < 20;

                    return (
                        <ConnectorNode
                            key={id}
                            id={id}
                            name={node.name}
                            bpn={node.bpn}
                            position={node}
                            rotation={rotation}
                            isConnected={isConnected}
                            onZoom={handleNodeClick}
                            isZoomed={isFocused && activeConnector === id}
                            onAction={onAction}
                            onEdit={handleEditNode}
                            onDelete={handleDeleteNode}
                            logs={logs[id] || logs.system || []}
                            catalog={catalog}
                            viewScale={finalScale}
                            simulationState={simulationState}
                            onDragEnd={(e, info) => handleDragEnd(id, info)}
                            onDragStart={() => handleDragStart(id)}
                            onDrag={(e, info) => handleDrag(id, info)}
                            scale={viewState.scale}
                            participantData={node}
                            allNodes={nodes}
                            onDiscoveryPulse={onDiscoveryPulse}
                            minimalView={minimalView}
                            vocabularyConnected={vocabHub.isConnected}
                            controlPlaneGlow={
                                // Glow wenn spezifischer Node (Catalog-Anfrage) und NICHT dataPlane/dataWire type
                                // Unterstützt sowohl einzelnes Objekt als auch Array
                                (() => {
                                    const glowList = Array.isArray(controlPlaneGlow) ? controlPlaneGlow : (controlPlaneGlow ? [controlPlaneGlow] : []);
                                    const matchingGlow = glowList.find(g => g?.nodeId === id && !['dataPlane', 'dataPlaneGlow', 'dataWire'].includes(g?.type));
                                    return matchingGlow ? matchingGlow.intensity : 0;
                                })()
                            }
                            dataPlaneGlowExternal={
                                // Data Plane Glow für Provider (dauerhaft leuchtend, auch während Wire-Animation)
                                // Unterstützt sowohl einzelnes Objekt als auch Array
                                (() => {
                                    const glowList = Array.isArray(controlPlaneGlow) ? controlPlaneGlow : (controlPlaneGlow ? [controlPlaneGlow] : []);
                                    const matchingGlow = glowList.find(g => g?.nodeId === id && ['dataPlane', 'dataPlaneGlow', 'dataWire'].includes(g?.type));
                                    return matchingGlow ? matchingGlow.intensity : 0;
                                })()
                            }
                            dataWirePulseExternal={
                                // Data Wire Pulse für Provider (Licht auf dem gelben Kabel)
                                // Unterstützt sowohl einzelnes Objekt als auch Array
                                (() => {
                                    const glowList = Array.isArray(controlPlaneGlow) ? controlPlaneGlow : (controlPlaneGlow ? [controlPlaneGlow] : []);
                                    const matchingGlow = glowList.find(g => g?.nodeId === id && g?.type === 'dataWire');
                                    return matchingGlow ? matchingGlow.direction : false;
                                })()
                            }
                            setControlPlaneGlow={setControlPlaneGlow}
                            ringLight={ringLight}
                            setRingLight={setRingLight}
                            allNodesPositions={nodes}
                            onRequestContract={onRequestContract}
                            runContractAnimation={runContractAnimation}
                            dataPlaneConnection={dataPlaneConnection}
                            setDataPlaneConnection={setDataPlaneConnection}
                            dataTransfer={dataTransfer}
                            setDataTransfer={setDataTransfer}
                            assets={nodeAssets[id] || []}
                            onDeleteAsset={(assetId) => handleDeleteAsset(id, assetId)}
                            onAddAsset={(asset) => handleAddAsset(id, asset)}
                            onEditAsset={(assetId, payload, currentNodeId) => handleEditAsset(assetId, payload, currentNodeId || id)}
                            isDemo={isDemo}
                            isNewlyAdded={Boolean(appearingHostedNodeIds[id])}
                        />
                    );
                })}

                {/* Transfer Beam (Legacy) */}
                <TransferBeam
                    fromNode={nodes.bob}
                    toNode={nodes.alice}
                    isActive={simulationState === 'transferring' && !dataPlaneConnection && !dataTransfer}
                />

                {/* Data Plane Beam - neue Animation */}
                {(dataPlaneConnection || dataTransfer) && (
                    <DataPlaneBeam
                        fromNode={dataPlaneConnection ? nodes[dataPlaneConnection.fromNodeId] : nodes[dataTransfer?.fromNodeId]}
                        toNode={dataPlaneConnection ? nodes[dataPlaneConnection.toNodeId] : nodes[dataTransfer?.toNodeId]}
                        connection={dataPlaneConnection}
                        transfer={dataTransfer}
                        fromRotation={dataPlaneConnection ? nodes[dataPlaneConnection.fromNodeId]?.rotation : nodes[dataTransfer?.fromNodeId]?.rotation}
                        toRotation={dataPlaneConnection ? nodes[dataPlaneConnection.toNodeId]?.rotation : nodes[dataTransfer?.toNodeId]?.rotation}
                    />
                )}

                {/* Control Plane Beam - für Catalog-Anfragen */}
                {(() => {
                    const ringConnections = Array.isArray(ringLight) ? ringLight : (ringLight ? [ringLight] : []);
                    return ringConnections
                        .filter((connection) => nodes[connection?.fromNodeId] && nodes[connection?.toNodeId])
                        .map((connection, idx) => (
                            <ControlPlaneBeam
                                key={`ring-${connection.fromNodeId}-${connection.toNodeId}-${connection.building ? 'b' : ''}${connection.established ? 'e' : ''}${connection.returning ? 'r' : ''}-${idx}`}
                                fromNode={nodes[connection.fromNodeId]}
                                toNode={nodes[connection.toNodeId]}
                                connection={connection}
                            />
                        ));
                })()}
            </motion.div>
            )}

            {/* Zoom Out Button - nur bei hohem Zoom-Level anzeigen */}
            <ZoomOutButton
                onClick={resetView}
                isVisible={Boolean(activeConnector) || finalScale > ZOOM_THRESHOLD_FOCUS}
            />

            {/* Zoom controls for users without a scroll wheel */}
            <ZoomControls
                scale={finalScale}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
            />

            <DataspaceServicesPanel
                vocabularyEnabled={vocabHub.isEnabled}
                onVocabularyChange={(next) => {
                    vocabHub.setEnabled(next);
                    if (!next) setHubDialogOpen(false);
                }}
                validatorEnabled={validator.isEnabled}
                onValidatorChange={validator.setEnabled}
            />

            {hubDialogOpen && (
                <VocabularyHubDialog
                    dataspaceId={dataspaceId}
                    isConnected={vocabHub.isConnected}
                    focusProfileId={hubFocusProfileId}
                    initialTab={hubDialogTab === 'validation' && !validator.isActive ? 'profiles' : hubDialogTab}
                    validation={validator.isActive ? validator : null}
                    onCatalogChange={validator.run}
                    onClose={() => setHubDialogOpen(false)}
                />
            )}
        </div>
        </ValidationReportContext.Provider>
        </OpenHubProfileContext.Provider>
    );
});

export default MacroView;
