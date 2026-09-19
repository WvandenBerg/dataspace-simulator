import React, { useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import ConnectorNode from './ConnectorNode';
import DataspaceCircle from './DataspaceCircle';
import TransferBeam from './TransferBeam';
import DataPlaneBeam from './DataPlaneBeam';
import ControlPlaneBeam from './ControlPlaneBeam';
import ZoomOutButton from './ZoomOutButton';
import ZoomControls from './ZoomControls';
import { useViewState } from './hooks/useViewState';
import { useDragNodes } from './hooks/useDragNodes';
import './Components.css';

const DATASPACE_RADIUS = 550;
const CONNECTOR_OFFSET = 60;

// Preset participants for the demo dataspace
export const PRESET_PARTICIPANTS = {
    bergstein: {
        name: 'Bergstein Bau GmbH',
        bpn: 'did:web:bergstein-bau.sim.local',
        location: 'Munich, Germany',
        roles: { provider: true, consumer: true },
        domain: 'Construction',
        metadata: { industry: 'construction', orgRole: 'contractor' },
        ontologies: ['IFC', 'BOT'],
        dataCategories: ['BIM', 'Documents', 'Schedules'],
        formats: ['JSON', 'IFC', 'PDF'],
        tags: ['Hochbau', 'Sanierung', 'Generalunternehmer']
    },
    nordbeton: {
        name: 'NordBeton AG',
        bpn: 'did:web:nordbeton-ag.sim.local',
        location: 'Hamburg, Deutschland',
        roles: { provider: true, consumer: true },
        domain: 'Construction',
        metadata: { industry: 'construction', orgRole: 'supplier' },
        ontologies: ['IFC', 'BOT'],
        dataCategories: ['BIM', 'Documents'],
        formats: ['JSON', 'IFC', 'CSV'],
        tags: ['Infrastruktur', 'Tiefbau', 'Beton']
    },
    stahlwerk: {
        name: 'Stahlwerk Weber',
        bpn: 'did:web:stahlwerk-weber.sim.local',
        location: 'Essen, Deutschland',
        roles: { provider: true, consumer: false },
        domain: 'Manufacturing',
        metadata: { industry: 'manufacturing', orgRole: 'manufacturer' },
        ontologies: ['IFC'],
        dataCategories: ['Documents', 'Contracts'],
        formats: ['JSON', 'PDF', 'CSV'],
        tags: ['Stahlbau', 'Industriehallen', 'Zulieferer']
    },
    fundament: {
        name: 'Fundament Plus GmbH',
        bpn: 'did:web:fundament-plus.sim.local',
        location: 'Stuttgart, Deutschland',
        roles: { provider: true, consumer: true },
        domain: 'Construction',
        metadata: { industry: 'construction', orgRole: 'customer' },
        ontologies: ['IFC', 'BOT'],
        dataCategories: ['BIM', 'GIS', 'Documents'],
        formats: ['JSON', 'IFC'],
        tags: ['Civil Engineering', 'Foundations', 'Special Foundation Works']
    },
    krantech: {
        name: 'KranTech Solutions',
        bpn: 'did:web:krantech-solutions.sim.local',
        location: 'Frankfurt, Deutschland',
        roles: { provider: true, consumer: true },
        domain: 'Logistics',
        metadata: { industry: 'logistics', orgRole: 'supplier' },
        ontologies: ['BOT'],
        dataCategories: ['IoT', 'Schedules'],
        formats: ['JSON', 'CSV'],
        tags: ['Construction Equipment', 'Logistics', 'Cranes']
    },
    elektro: {
        name: 'Elektro Schneider',
        bpn: 'did:web:elektro-schneider.sim.local',
        location: 'Cologne, Germany',
        roles: { provider: true, consumer: true },
        domain: 'Energy',
        metadata: { industry: 'energy', orgRole: 'contractor' },
        ontologies: ['BRICK', 'SAREF'],
        dataCategories: ['IoT', 'Documents'],
        formats: ['JSON', 'PDF'],
        tags: ['Elektroinstallation', 'Handwerk', 'Smart Building']
    }
};

// Initial nodes for demo dataspace (evenly distributed, one at bottom)
const INITIAL_NODES = {
    bergstein: {
        x: Math.cos(210 * Math.PI / 180) * 610,
        y: Math.sin(210 * Math.PI / 180) * 610,
        ...PRESET_PARTICIPANTS.bergstein
    },

    nordbeton: {
        x: Math.cos(330 * Math.PI / 180) * 610,
        y: Math.sin(330 * Math.PI / 180) * 610,
        ...PRESET_PARTICIPANTS.nordbeton
    },
    stahlwerk: {
        x: Math.cos(90 * Math.PI / 180) * 610,
        y: Math.sin(90 * Math.PI / 180) * 610,
        ...PRESET_PARTICIPANTS.stahlwerk
    }
};

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
    catalogRequestLine,
    onViewCatalog,
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

    // Only the two built-in dataspaces get the preset participants. A dataspace
    // the user creates starts empty, or is filled from a scenario, rather than
    // inheriting three construction firms with nothing to serve.
    const initialNodesForDataspace = React.useMemo(() => {
        if (dataspaceId === 'demo') return INITIAL_NODES;
        if (dataspaceId !== 'simulator') return {};
        const namespaced = {};
        for (const [id, node] of Object.entries(INITIAL_NODES)) {
            namespaced[`${dataspaceId}::${id}`] = node;
        }
        return namespaced;
    }, [dataspaceId]);
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
    } = useDragNodes(initialNodesForDataspace, isFocused, dataspaceId, minimalView ? 330 : 550);

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
        } catch (err) {
            console.error('[MacroView] Edit asset failed:', err.message || err);
        }
    };

    // Delete Handler
    const handleDeleteNode = (id) => {
        if (!isDemo) {
            console.log('[MacroView] Cannot delete node in hosted mode');
            return;
        }
        removeNode(id);
        if (activeConnector === id) {
            onConnectorClick(null);
        }
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
        addNode,
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
    const canvasCenterX = containerRef.current ? containerRef.current.clientWidth / 2 : window.innerWidth / 2;
    const canvasCenterY = containerRef.current ? containerRef.current.clientHeight / 2 : window.innerHeight / 2;
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
        <div
            className="macro-view-container"
            ref={containerRef}
            onWheel={(e) => handleWheel(e, containerRef)}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={handlePanStart}
            style={{ cursor: 'default' }}
        >
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

                {/* Catalog Request Line - Control Plane zu Control Plane (blau) */}
                {catalogRequestLine && nodes[catalogRequestLine.from] && nodes[catalogRequestLine.to] && (() => {
                    // Calculate shortened positions (80px offset toward center from each node)
                    const fromNode = nodes[catalogRequestLine.from];
                    const toNode = nodes[catalogRequestLine.to];
                    const BEAM_OFFSET = 80; // Distance to shorten from each end

                    // Calculate direction vector
                    const dx = toNode.x - fromNode.x;
                    const dy = toNode.y - fromNode.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const ux = dx / dist; // Unit vector
                    const uy = dy / dist;

                    // Offset start and end points
                    const x1 = fromNode.x + ux * BEAM_OFFSET;
                    const y1 = fromNode.y + uy * BEAM_OFFSET;
                    const x2 = toNode.x - ux * BEAM_OFFSET;
                    const y2 = toNode.y - uy * BEAM_OFFSET;

                    return (
                        <svg
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '100%',
                                overflow: 'visible',
                                pointerEvents: 'none',
                                zIndex: 5
                            }}
                        >
                            <defs>
                                <linearGradient id="catalogLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
                                    <stop offset="50%" stopColor="#60a5fa" stopOpacity="1" />
                                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.8" />
                                </linearGradient>
                                <filter id="catalogGlow">
                                    <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                                    <feMerge>
                                        <feMergeNode in="coloredBlur" />
                                        <feMergeNode in="SourceGraphic" />
                                    </feMerge>
                                </filter>
                            </defs>
                            <motion.line
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke="url(#catalogLineGradient)"
                                strokeWidth="4"
                                strokeLinecap="round"
                                filter="url(#catalogGlow)"
                                initial={{ pathLength: 0, opacity: 0 }}
                                animate={{ pathLength: 1, opacity: 1 }}
                                transition={{ duration: 0.8, ease: "easeOut" }}
                            />
                            {/* Animated pulse along the line */}
                            <motion.circle
                                r="8"
                                fill="#60a5fa"
                                filter="url(#catalogGlow)"
                                initial={{ opacity: 0 }}
                                animate={{
                                    cx: [x1, x2],
                                    cy: [y1, y2],
                                    opacity: [0, 1, 1, 0]
                                }}
                                transition={{
                                    duration: 1.5,
                                    repeat: Infinity,
                                    ease: "linear"
                                }}
                            />
                        </svg>
                    );
                })()}

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
                            onViewCatalog={onViewCatalog}
                            onDiscoveryPulse={onDiscoveryPulse}
                            minimalView={minimalView}
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
                            allNodeAssets={nodeAssets}
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
        </div>
    );
});

export default MacroView;
