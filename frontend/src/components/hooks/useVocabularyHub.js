import { useCallback, useRef, useState } from 'react';

/**
 * Position of the Vocabulary Hub node, and whether it currently reaches this
 * dataspace.
 *
 * Connection is proximity, the same rule participants already live by, so the
 * hub can be pulled away and the dataspace loses alignment-widened discovery
 * in front of you. The position is a view concern rather than dataspace data,
 * so it stays in localStorage instead of the nodes table.
 */
const OFFSET_FROM_RING = 180;
const CONNECT_MARGIN = 340;

const storageKey = (dataspaceId) => `vocabhub-position:${dataspaceId}`;

function loadPosition(dataspaceId, ringRadius) {
    try {
        const stored = JSON.parse(localStorage.getItem(storageKey(dataspaceId)));
        if (Number.isFinite(stored?.x) && Number.isFinite(stored?.y)) return stored;
    } catch {
        // Fall through to the default placement.
    }
    return { x: 0, y: -(ringRadius + OFFSET_FROM_RING) };
}

export function useVocabularyHub(dataspaceId, ringRadius) {
    const [state, setState] = useState(() => ({
        dataspaceId,
        position: loadPosition(dataspaceId, ringRadius),
    }));
    const dragStartRef = useRef(null);

    if (state.dataspaceId !== dataspaceId) {
        setState({ dataspaceId, position: loadPosition(dataspaceId, ringRadius) });
    }

    const { position } = state;
    const distance = Math.sqrt(position.x * position.x + position.y * position.y);
    const isConnected = distance < ringRadius + CONNECT_MARGIN;

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

    return { position, isConnected, onDragStart, onDrag, onDragEnd };
}
