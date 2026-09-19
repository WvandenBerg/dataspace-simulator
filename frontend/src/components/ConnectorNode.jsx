import React, { useEffect, useRef, useState } from 'react';
import { motion, useSpring } from 'framer-motion';
import ConnectorStack from './ConnectorStack';
import BalloonGroup from './BalloonGroup/index.jsx';
import WireSVG from './WireSVG';
import { useWirePaths } from './hooks/useWirePaths';
import { useNodeDrag } from './hooks/useNodeDrag';
import './Components.css';


const normalizeRotation = (currentRotation, targetRotation) => {
    // Normalisiere beide auf 0-360
    let current = ((currentRotation % 360) + 360) % 360;
    let target = ((targetRotation % 360) + 360) % 360;

    // Berechne die Differenz
    let diff = target - current;

    // Wenn die Differenz > 180°, nimm den kürzeren Weg
    if (diff > 180) {
        diff -= 360;
    } else if (diff < -180) {
        diff += 360;
    }

    return currentRotation + diff;
};

const ConnectorNode = ({
    id,
    name,
    bpn,
    position,
    rotation = 0,
    isConnected = true,
    onZoom,
    isZoomed,
    onAction,
    onEdit,
    onDelete,
    logs = [],
    catalog = [],
    simulationState,
    onDragEnd,
    onDragStart,
    onDrag,
    scale = 1,
    viewScale = 0.4,
    // Neue Props für Browse Dataspace
    participantData = {},
    allNodes = {},
    onViewCatalog = () => { },
    onDiscoveryPulse = () => { },
    controlPlaneGlow = 0,
    dataPlaneGlowExternal = 0,
    dataWirePulseExternal = false,
    setControlPlaneGlow = () => { },
    ringLight = null,
    setRingLight = () => { },
    allNodesPositions = {},
    onRequestContract = () => { },
    runContractAnimation = () => { },
    dataPlaneConnection = null,
    setDataPlaneConnection = () => { },
    dataTransfer = null,
    setDataTransfer = () => { },
    // Asset management
    assets = [],
    onDeleteAsset = () => { },
    onAddAsset = () => { },
    onEditAsset = () => { },
    // Demo vs hosted mode
    isDemo = true,
    // Minimal view mode
    minimalView = false,
    isNewlyAdded = false
}) => {
    // Lokaler State für eigene Suche (wird von BalloonGroup gesteuert)
    // Kann sein: false, 'toConnector', 'controlPlaneGlow', 'toUI'
    const [searchAnimationState, setSearchAnimationState] = useState(false);

    // Animation States
    const isBroadcasting = simulationState === 'broadcasting';
    const isNegotiating = simulationState === 'negotiating';
    const isTransferring = simulationState === 'transferring';

    // Ref um die letzte Rotation zu tracken (für kürzesten Weg)
    const lastRotationRef = useRef(rotation);

    // Spring for "Dangling" Rotation
    const springRotation = useSpring(rotation, { stiffness: 60, damping: 10 });

    // Wire Paths
    const { balloonX, balloonY, wire1Path, wire2Path } = useWirePaths(springRotation);

    // Drag Handling
    const { isDragging, hasDragged, handlePointerDown } = useNodeDrag({
        isZoomed,
        scale,
        onDragStart,
        onDrag,
        onDragEnd
    });

    // Update spring target - mit Normalisierung für kürzesten Weg
    useEffect(() => {
        const normalizedRotation = normalizeRotation(lastRotationRef.current, rotation);
        lastRotationRef.current = normalizedRotation;
        springRotation.set(normalizedRotation);
    }, [rotation, springRotation]);

    // Content rotation for readability
    const normRotation = (rotation % 360 + 360) % 360;
    const isLeftSide = normRotation > 90 && normRotation < 270;
    const contentRotation = isLeftSide ? 180 : 0;

    return (
        <motion.div
            className={`connector-node-schematic ${isZoomed ? 'zoomed' : ''}`}
            initial={isNewlyAdded ? { opacity: 0, scale: 0.6 } : false}
            animate={{
                x: position.x,
                y: position.y,
                zIndex: isZoomed ? 100 : (isConnected ? 10 : 5),
                scale: isDragging ? 1.05 : 1,
                opacity: isConnected ? 1 : 0.5
            }}
            transition={{
                x: { type: "spring", stiffness: 180, damping: 24 },
                y: { type: "spring", stiffness: 180, damping: 24 },
                scale: { type: "spring", stiffness: 300, damping: 30 },
                opacity: { duration: 0.3 }
            }}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 0,
                height: 0,
                overflow: 'visible',
                filter: isConnected ? 'none' : 'grayscale(100%)',
                cursor: isZoomed ? 'default' : (isDragging ? 'grabbing' : 'grab')
            }}
            onPointerDown={handlePointerDown}
            onClick={(e) => {
                if (!isZoomed && isConnected && !hasDragged.current) {
                    e.stopPropagation();
                    onZoom(id);
                }
            }}
        >
            {/* Wires */}
            <WireSVG
                wire1Path={wire1Path}
                wire2Path={wire2Path}
                isConnected={isConnected}
                controlPlanePulse={searchAnimationState === 'toConnector' ? 'toConnector' :
                    searchAnimationState === 'toUI' ? 'toUI' : false}
                dataPlanePulse={
                    // Lokale Animation oder externe Animation vom Provider
                    dataWirePulseExternal ? dataWirePulseExternal :
                        (searchAnimationState === 'dataToConnector' ? 'toConnector' :
                            searchAnimationState === 'dataToStorage' ? 'toStorage' : false)
                }
            />

            {/* Connector Stack - immer anzeigen */}
            <ConnectorStack
                rotation={rotation}
                contentRotation={contentRotation}
                isBroadcasting={isBroadcasting}
                isNegotiating={isNegotiating}
                isTransferring={isTransferring}
                controlPlaneGlow={controlPlaneGlow > 0 ? controlPlaneGlow :
                    (searchAnimationState === 'controlPlaneGlow' ? 1 : 0)}
                dataPlaneGlow={dataPlaneGlowExternal > 0 ? dataPlaneGlowExternal :
                    (searchAnimationState === 'dataPlaneGlow' ? 1 : 0)}
            />

            {/* Balloon Group */}
            <BalloonGroup
                balloonX={balloonX}
                balloonY={balloonY}
                name={name}
                bpn={bpn}
                isConnected={isConnected}
                onAction={onAction}
                onEdit={(data) => onEdit && onEdit(id, data)}
                onDelete={() => onDelete && onDelete(id)}
                catalog={catalog}
                logs={logs}
                viewScale={viewScale}
                participantData={participantData}
                allNodes={allNodes}
                currentNodeId={id}
                onViewCatalog={onViewCatalog}
                onDiscoveryPulse={onDiscoveryPulse}
                onRequestContract={onRequestContract}
                onLocalSearchChange={setSearchAnimationState}
                setControlPlaneGlow={setControlPlaneGlow}
                setRingLight={setRingLight}
                allNodesPositions={allNodes}
                runContractAnimation={runContractAnimation}
                dataPlaneConnection={dataPlaneConnection}
                setDataPlaneConnection={setDataPlaneConnection}
                dataTransfer={dataTransfer}
                setDataTransfer={setDataTransfer}
                assets={assets}
                onDeleteAsset={onDeleteAsset}
                onAddAsset={onAddAsset}
                onEditAsset={onEditAsset}
                isDemo={isDemo}
                minimalView={minimalView}
            />
        </motion.div>
    );
};

export default ConnectorNode;
