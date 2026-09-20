import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';

/**
 * The Vocabulary Hub as a node you can connect to a dataspace, or not.
 *
 * It sits outside the ring because it is not a participant: one hub serves
 * every dataspace. Connecting it is what grants this dataspace the ability to
 * widen a search along profile alignments. Drag it out of range and that
 * ability goes away, which is the whole argument for the hub made draggable.
 */
const HUB_SIZE = 84;

// eslint here has no react plugin, so a lowercase JSX root never counts as used.
const MotionDiv = motion.div;

const VocabularyHubNode = ({ position, isConnected, onDragStart, onDrag, onDragEnd, onClick }) => {
    const [isDragging, setIsDragging] = useState(false);
    const hasDragged = useRef(false);

    return (
        <MotionDiv
            drag
            dragMomentum={false}
            onDragStart={(e, info) => {
                hasDragged.current = true;
                setIsDragging(true);
                onDragStart?.(e, info);
            }}
            onDrag={onDrag}
            onDragEnd={(e, info) => {
                setIsDragging(false);
                onDragEnd?.(e, info);
                setTimeout(() => { hasDragged.current = false; }, 0);
            }}
            onPointerDown={() => { hasDragged.current = false; }}
            onClick={(e) => {
                if (hasDragged.current) return;
                e.stopPropagation();
                onClick?.();
            }}
            animate={{
                x: position.x,
                y: position.y,
                scale: isDragging ? 1.05 : 1,
                opacity: isConnected ? 1 : 0.55,
            }}
            transition={{
                x: { type: 'spring', stiffness: 180, damping: 24 },
                y: { type: 'spring', stiffness: 180, damping: 24 },
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
                zIndex: 8,
                filter: isConnected ? 'none' : 'grayscale(100%)',
                cursor: isDragging ? 'grabbing' : 'grab',
            }}
        >
            <div style={{
                position: 'absolute',
                transform: 'translate(-50%, -50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '6px',
            }}>
                <div style={{
                    width: `${HUB_SIZE}px`,
                    height: `${HUB_SIZE}px`,
                    borderRadius: '50%',
                    background: '#14532d',
                    border: `3px solid ${isConnected ? '#22c55e' : 'var(--border-subtle)'}`,
                    boxShadow: isConnected ? '0 0 24px rgba(34, 197, 94, 0.45)' : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <img
                        src="/assets/sth-logo.svg"
                        alt="Semantic Treehouse"
                        draggable={false}
                        style={{ width: '46px', height: '46px' }}
                    />
                </div>

                <div style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                }}>
                    Vocabulary Hub
                </div>
                <div style={{
                    fontSize: '0.62rem',
                    color: isConnected ? '#16a34a' : 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    whiteSpace: 'nowrap',
                }}>
                    {isConnected ? 'Connected' : 'Not connected'}
                </div>
            </div>
        </MotionDiv>
    );
};

export default VocabularyHubNode;
