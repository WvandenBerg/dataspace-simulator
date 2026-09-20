import { useCallback, useRef, useState } from 'react';

/**
 * Whether this dataspace has a vocabulary service at all, where its node sits,
 * and whether that node currently reaches the ring.
 *
 * Presence and reachability are deliberately separate. Switching the service
 * off models a dataspace that never adopted one; dragging the node out of range
 * models one it has but cannot reach. Both disable alignment-widened discovery,
 * and they should not look alike. Neither is dataspace data, so both live in
 * localStorage rather than the nodes table.
 */
// The connect margin is deliberately short: losing the service should take one
// deliberate drag, not a journey across the canvas. Participant cards reach as
// far as ~1180 from the centre, so within that margin there is no radius that
// clears them at every angle. The default parks in the gap above the card due
// east instead.
const OFFSET_FROM_RING = 210;
const CONNECT_MARGIN = 470;
const PARK_ANGLE = -10 * (Math.PI / 180);

const storageKey = (dataspaceId) => `vocabhub-position:${dataspaceId}`;
const enabledKey = (dataspaceId) => `vocabhub-enabled:${dataspaceId}`;

const defaultPosition = (ringRadius) => {
    const radius = ringRadius + OFFSET_FROM_RING;
    return { x: Math.round(radius * Math.cos(PARK_ANGLE)), y: Math.round(radius * Math.sin(PARK_ANGLE)) };
};

function loadPosition(dataspaceId, ringRadius) {
    try {
        const stored = JSON.parse(localStorage.getItem(storageKey(dataspaceId)));
        if (Number.isFinite(stored?.x) && Number.isFinite(stored?.y)) return stored;
    } catch {
        // Fall through to the default placement.
    }
    return defaultPosition(ringRadius);
}

// A dataspace has no vocabulary service until someone adds one.
function loadEnabled(dataspaceId) {
    return localStorage.getItem(enabledKey(dataspaceId)) === 'true';
}

function loadState(dataspaceId, ringRadius) {
    return {
        dataspaceId,
        position: loadPosition(dataspaceId, ringRadius),
        isEnabled: loadEnabled(dataspaceId),
    };
}

export function useVocabularyHub(dataspaceId, ringRadius) {
    const [state, setState] = useState(() => loadState(dataspaceId, ringRadius));
    const dragStartRef = useRef(null);

    if (state.dataspaceId !== dataspaceId) {
        setState(loadState(dataspaceId, ringRadius));
    }

    const { position, isEnabled } = state;
    const distance = Math.sqrt(position.x * position.x + position.y * position.y);
    const isConnected = isEnabled && distance < ringRadius + CONNECT_MARGIN;

    const move = (start, info) => ({ x: start.x + info.offset.x, y: start.y + info.offset.y });

    const onDragStart = useCallback(() => {
        setState((prev) => {
            dragStartRef.current = prev.position;
            return prev;
        });
    }, []);

    const onDrag = useCallback((event, info) => {
        const start = dragStartRef.current;
        if (start) setState((prev) => ({ ...prev, position: move(start, info) }));
    }, []);

    const onDragEnd = useCallback((event, info) => {
        const start = dragStartRef.current;
        dragStartRef.current = null;
        if (!start) return;
        const next = move(start, info);
        setState((prev) => ({ ...prev, position: next }));
        try {
            localStorage.setItem(storageKey(dataspaceId), JSON.stringify(next));
        } catch {
            // A hub that forgets where it was put is still a usable hub.
        }
    }, [dataspaceId]);

    const setEnabled = useCallback((next) => {
        setState((prev) => {
            // Restoring a far-away position would show the service arriving already
            // out of range, which reads as a fault rather than a choice.
            const position = next ? defaultPosition(ringRadius) : prev.position;
            try {
                localStorage.setItem(enabledKey(dataspaceId), String(next));
                if (next) localStorage.setItem(storageKey(dataspaceId), JSON.stringify(position));
            } catch {
                // The toggle still works for this session.
            }
            return { ...prev, isEnabled: next, position };
        });
    }, [dataspaceId, ringRadius]);

    return { position, isEnabled, isConnected, setEnabled, onDragStart, onDrag, onDragEnd };
}
