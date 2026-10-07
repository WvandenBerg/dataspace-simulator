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
const VALIDATOR_SIZE = 70;
const GAUGE_RADIUS = 30;
const GAUGE_LENGTH = 2 * Math.PI * GAUGE_RADIUS;
// Away from the wire, which leaves the hub on the side facing the ring.
const VALIDATOR_ANGLE = -50 * (Math.PI / 180);

// eslint here has no react plugin, so a lowercase JSX root never counts as used.
const MotionDiv = motion.div;

// The share of entries without violations: warnings alone do not fail an entry.
const ValidatorDisc = ({ validation, rotation, onClick }) => {
    const { report, isRunning, error } = validation;
    const total = report?.total ?? 0;
    const passing = report ? total - report.violations : 0;
    const share = total > 0 ? passing / total : 0;

    const angle = rotation * (Math.PI / 180) + VALIDATOR_ANGLE;
    const rimRadius = HUB_SIZE / 2 + 4;
    const center = { x: HUB_SIZE / 2 + Math.cos(angle) * rimRadius, y: HUB_SIZE / 2 + Math.sin(angle) * rimRadius };
    // The label sits on the far side from the hub, aligned so it grows away from it.
    const align = (v) => (v > 0.3 ? 0 : v < -0.3 ? -100 : -50);
    const labelDistance = VALIDATOR_SIZE / 2 + 2;

    let middle = `${passing}/${total}`;
    if (error) middle = '!';
    else if (!report) middle = '\u2026';

    return (
        <>
            <div
                onClick={onClick}
                title={error || (report ? `${passing} of ${total} entries without violations` : 'Validating...')}
                style={{
                    position: 'absolute',
                    left: `${center.x - VALIDATOR_SIZE / 2}px`,
                    top: `${center.y - VALIDATOR_SIZE / 2}px`,
                    width: `${VALIDATOR_SIZE}px`,
                    height: `${VALIDATOR_SIZE}px`,
                    borderRadius: '50%',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                }}
            >
                <svg width={VALIDATOR_SIZE} height={VALIDATOR_SIZE} style={{ position: 'absolute', inset: '-1px', transform: 'rotate(-90deg)' }}>
                    <circle cx={VALIDATOR_SIZE / 2} cy={VALIDATOR_SIZE / 2} r={GAUGE_RADIUS} fill="none" stroke="var(--border-subtle)" strokeWidth="5" />
                    {report && total > 0 && (
                        <>
                            <circle
                                cx={VALIDATOR_SIZE / 2} cy={VALIDATOR_SIZE / 2} r={GAUGE_RADIUS} fill="none"
                                stroke="#dc2626" strokeWidth="5" opacity={share < 1 ? 0.8 : 0}
                            />
                            <circle
                                cx={VALIDATOR_SIZE / 2} cy={VALIDATOR_SIZE / 2} r={GAUGE_RADIUS} fill="none"
                                stroke="#16a34a" strokeWidth="5"
                                strokeDasharray={`${share * GAUGE_LENGTH} ${GAUGE_LENGTH}`}
                                style={{ transition: 'stroke-dasharray 0.6s ease' }}
                            />
                        </>
                    )}
                </svg>
                <span style={{
                    fontSize: middle.length > 4 ? '0.8rem' : '0.95rem',
                    fontWeight: 700,
                    color: error ? '#dc2626' : 'var(--text-primary)',
                    opacity: isRunning ? 0.45 : 1,
                    transition: 'opacity 0.2s',
                }}>
                    {middle}
                </span>
            </div>
            <div style={{
                position: 'absolute',
                left: `${center.x + Math.cos(angle) * labelDistance}px`,
                top: `${center.y + Math.sin(angle) * labelDistance}px`,
                transform: `translate(${align(Math.cos(angle))}%, ${align(Math.sin(angle))}%)`,
                fontSize: '0.7rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
            }}>
                Metadata Validator
            </div>
        </>
    );
};

const VocabularyHubNode = ({ position, isConnected, scale, onDragStart, onDrag, onDragEnd, onClick, validation = null, onValidatorClick }) => {
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

                {validation && (
                    <ValidatorDisc
                        validation={validation}
                        rotation={rotation}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (!hasDragged.current) onValidatorClick?.();
                        }}
                    />
                )}

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
