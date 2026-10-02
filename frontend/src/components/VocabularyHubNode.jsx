import React, { useEffect } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import ConnectorStack from './ConnectorStack';
import WireSVG from './WireSVG';
import { useNodeDrag } from './hooks/useNodeDrag';
import { useWirePaths } from './hooks/useWirePaths';

/**
 * The dataspace's vocabulary service, joining the ring through a connector of
 * its own like any participant does.
 *
 * A service is not a party to contracts, so where a participant hangs a card
 * off its connector, the hub hangs a disc: circles are services, cards are
 * participants. Connecting it is what lets this dataspace widen a search along
 * profile alignments; drag it off the ring and that ability goes away.
 */
// Matches the height of a participant card, so the hub reads as a peer of the
// nodes on the ring rather than an annotation next to them.
const HUB_SIZE = 176;
const LOGO_SIZE = 96;

// eslint here has no react plugin, so a lowercase JSX root never counts as used.
const MotionDiv = motion.div;

const VocabularyHubNode = ({ position, isConnected, scale, onDragStart, onDrag, onDragEnd, onClick }) => {
    const { isDragging, hasDragged, handlePointerDown } = useNodeDrag({
        isZoomed: false,
        scale,
        onDragStart,
        onDrag,
        onDragEnd,
    });

    const rotation = Math.atan2(position.y, position.x) * (180 / Math.PI);
    const rotationValue = useMotionValue(rotation);
    useEffect(() => { rotationValue.set(rotation); }, [rotation, rotationValue]);
    const { balloonX, balloonY, wire1Path, wire2Path } = useWirePaths(rotationValue);

    const normRotation = ((rotation % 360) + 360) % 360;
    const contentRotation = normRotation > 90 && normRotation < 270 ? 180 : 0;

    return (
        <MotionDiv
            onPointerDown={handlePointerDown}
            initial={false}
            animate={{
                x: position.x,
                y: position.y,
                scale: isDragging ? 1.05 : 1,
                opacity: isConnected ? 1 : 0.5,
            }}
            transition={{
                x: isDragging ? { duration: 0 } : { type: 'spring', stiffness: 180, damping: 24 },
                y: isDragging ? { duration: 0 } : { type: 'spring', stiffness: 180, damping: 24 },
                scale: { type: 'spring', stiffness: 300, damping: 30 },
                opacity: { duration: 0.3 },
            }}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: 0,
                height: 0,
                overflow: 'visible',
                zIndex: 10,
                filter: isConnected ? 'none' : 'grayscale(100%)',
                cursor: isDragging ? 'grabbing' : 'grab',
            }}
        >
            <WireSVG wire1Path={wire1Path} wire2Path={wire2Path} isConnected={isConnected} />

            <ConnectorStack rotation={rotation} contentRotation={contentRotation} />

            <MotionDiv
                onClick={(e) => {
                    if (hasDragged.current) return;
                    e.stopPropagation();
                    onClick?.();
                }}
                style={{
                    position: 'absolute',
                    x: balloonX,
                    y: balloonY,
                    translateX: '-50%',
                    translateY: '-50%',
                    width: `${HUB_SIZE}px`,
                    height: `${HUB_SIZE}px`,
                    borderRadius: '50%',
                    background: '#14532d',
                    border: `4px solid ${isConnected ? '#22c55e' : 'var(--border-subtle)'}`,
                    boxShadow: isConnected ? '0 0 40px rgba(34, 197, 94, 0.45)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 3,
                }}
            >
                <img
                    src="/assets/sth-logo.svg"
                    alt="Semantic Treehouse"
                    draggable={false}
                    style={{ width: `${LOGO_SIZE}px`, height: `${LOGO_SIZE}px` }}
                />

                {/* Absolutely positioned so the disc alone sits on the wire's end. */}
                <div style={{
                    position: 'absolute',
                    top: `${HUB_SIZE + 28}px`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                }}>
                    {/* Matches .schematic-title: this is infrastructure, like a
                        connector, not a named participant. */}
                    <div style={{
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        whiteSpace: 'nowrap',
                    }}>
                        Vocabulary Hub
                    </div>
                    <div style={{
                        fontSize: '0.7rem',
                        color: isConnected ? '#16a34a' : 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        whiteSpace: 'nowrap',
                    }}>
                        {isConnected ? 'Connected' : 'Not connected'}
                    </div>
                </div>
            </MotionDiv>
        </MotionDiv>
    );
};

export default VocabularyHubNode;
