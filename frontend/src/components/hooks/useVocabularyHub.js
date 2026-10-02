import { useCallback, useEffect, useRef, useState } from 'react';
import { largestGapAngle } from './useDragNodes';

/**
 * Whether this dataspace runs a vocabulary service, and where its connector sits.
 *
 * Presence and reachability stay separate. Switching the service off models a
 * dataspace that never adopted one; dragging its connector off the ring models
 * one it has but cannot reach. Both are configuration of the dataspace, so they
 * live in the backend rather than in this browser.
 */
// Same snap and tolerance as a participant's connector, so both join the ring alike.
const SNAP_THRESHOLD = 100;
const CONNECT_TOLERANCE = 20;

const settingsUrl = (dataspaceId) => `/api/dataspaces/${encodeURIComponent(dataspaceId)}/settings`;

function persist(dataspaceId, vocabHub) {
    return fetch(settingsUrl(dataspaceId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabHub }),
    }).catch(console.error);
}

const emptyState = (dataspaceId) => ({ dataspaceId, position: null, isEnabled: false });

const isOnRing = (p, ringRadius) => p !== null && Math.abs(Math.hypot(p.x, p.y) - ringRadius) < CONNECT_TOLERANCE;

export function useVocabularyHub(dataspaceId, ringRadius, participantPositions) {
    const [state, setState] = useState(() => emptyState(dataspaceId));
    const dragStartRef = useRef(null);

    if (state.dataspaceId !== dataspaceId) {
        setState(emptyState(dataspaceId));
    }

    useEffect(() => {
        let cancelled = false;
        fetch(settingsUrl(dataspaceId))
            .then((r) => (r.ok ? r.json() : {}))
            .then((settings) => {
                if (cancelled) return;
                const hub = settings?.vocabHub || {};
                const position = Number.isFinite(hub.x) && Number.isFinite(hub.y) ? { x: hub.x, y: hub.y } : null;
                setState({ dataspaceId, position, isEnabled: hub.enabled === true });
            })
            .catch(console.error);
        return () => { cancelled = true; };
    }, [dataspaceId]);

    const { position, isEnabled } = state;
    const isConnected = isEnabled && isOnRing(position, ringRadius);

    const move = (start, info) => ({ x: start.x + info.offset.x, y: start.y + info.offset.y });

    const onDragStart = useCallback(() => {
        dragStartRef.current = position;
    }, [position]);

    const onDrag = useCallback((event, info) => {
        const start = dragStartRef.current;
        if (start) setState((prev) => ({ ...prev, position: move(start, info) }));
    }, []);

    const onDragEnd = useCallback((event, info) => {
        const start = dragStartRef.current;
        dragStartRef.current = null;
        if (!start) return;
        let next = move(start, info);
        if (Math.abs(Math.hypot(next.x, next.y) - ringRadius) < SNAP_THRESHOLD) {
            const angle = Math.atan2(next.y, next.x);
            next = { x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius };
        }
        setState((prev) => ({ ...prev, position: next }));
        persist(dataspaceId, next);
    }, [dataspaceId, ringRadius]);

    // A service arriving already off the ring reads as a fault rather than a choice,
    // so switching it on places it in the widest gap between participants.
    const setEnabled = useCallback((next) => {
        let nextPosition = position;
        if (next && !isOnRing(position, ringRadius)) {
            const angle = largestGapAngle(participantPositions);
            nextPosition = { x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius };
        }
        // The backend refuses hub requests while the service is off, so it must know before anything asks.
        persist(dataspaceId, nextPosition ? { enabled: next, ...nextPosition } : { enabled: next })
            .then(() => setState((prev) => ({ ...prev, isEnabled: next, position: nextPosition })));
    }, [dataspaceId, ringRadius, position, participantPositions]);

    return { position, isEnabled, isConnected, setEnabled, onDragStart, onDrag, onDragEnd };
}
