import React from 'react';
import { motion } from 'framer-motion';
import { useNodeDrag } from './hooks/useNodeDrag';

/**
 * The Vocabulary Hub as a node you can connect to a dataspace, or not.
 *
 * It sits outside the ring because it is not a participant: one hub serves
 * every dataspace. Connecting it is what grants this dataspace the ability to
 * widen a search along profile alignments. Drag it out of range and that
 * ability goes away, which is the whole argument for the hub made draggable.
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

    return (
        <MotionDiv
            onPointerDown={handlePointerDown}
            onClick={(e) => {
                if (hasDragged.current) return;
                e.stopPropagation();
                onClick?.();
            }}
            initial={false}
            animate={{
                x: position.x,
                y: position.y,
                scale: isDragging ? 1.05 : 1,
                opacity: isConnected ? 1 : 0.55,
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
                zIndex: 12,
                filter: isConnected ? 'none' : 'grayscale(100%)',
                cursor: isDragging ? 'grabbing' : 'grab',
            }}
        >
            <div style={{
                position: 'absolute',
                transform: 'translate(-50%, -50%)',
                width: `${HUB_SIZE}px`,
                height: `${HUB_SIZE}px`,
                borderRadius: '50%',
                background: '#14532d',
                border: `4px solid ${isConnected ? '#22c55e' : 'var(--border-subtle)'}`,
                boxShadow: isConnected ? '0 0 40px rgba(34, 197, 94, 0.45)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                <img
                    src="/assets/sth-logo.svg"
                    alt="Semantic Treehouse"
                    draggable={false}
                    style={{ width: `${LOGO_SIZE}px`, height: `${LOGO_SIZE}px` }}
                />

                {/* Absolutely positioned so the disc, not the disc plus caption,
                    is what sits on the hub's coordinates and takes the tether. */}
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
            </div>
        </MotionDiv>
    );
};

export default VocabularyHubNode;
