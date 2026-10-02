import { useState, useRef, useEffect, useCallback } from 'react';

const DEFAULT_DATASPACE_RADIUS = 550;
const CONNECTOR_OFFSET = 60;
const SNAP_THRESHOLD = 100;

const API_BASE = '/api';

// Middle of the widest empty arc between the given positions on the ring.
export function largestGapAngle(positions) {
    const angles = positions.map(p => Math.atan2(p.y, p.x));
    let bestAngle = -Math.PI / 2;
    if (angles.length > 0) {
        const sorted = [...angles].sort((a, b) => a - b);
        let maxGap = 0;
        for (let i = 0; i < sorted.length; i++) {
            const next = i === sorted.length - 1 ? sorted[0] + 2 * Math.PI : sorted[i + 1];
            const gap = next - sorted[i];
            if (gap > maxGap) { maxGap = gap; bestAngle = sorted[i] + gap / 2; }
        }
    }
    return bestAngle;
}

const DEFAULT_METADATA = {
    location: '',
    dspEndpoint: '',
    catalogUrl: '',
    roles: { provider: true, consumer: true },
    domain: '',
    ontologies: [],
    dataCategories: [],
    formats: [],
    tags: []
};

/**
 * useDragNodes — manages simulator canvas nodes
 *
 * Nodes are persisted in SQLite via the backend API.
 * localStorage is NOT used — all state survives browser reload via the backend.
 */
export const useDragNodes = (initialNodes, isZoomed, dataspaceId = 'demo', dataspaceRadius = DEFAULT_DATASPACE_RADIUS) => {
    const targetRadius = dataspaceRadius + CONNECTOR_OFFSET;

    const [nodes, setNodes] = useState(initialNodes);
    const [loaded, setLoaded] = useState(false);
    const [draggedId, setDraggedId] = useState(null);
    const [isSnapZone, setIsSnapZone] = useState(false);
    const [dragState, setDragState] = useState({ angle: 0, distance: 0 });

    const dragStartPosRef = useRef(null);
    const draggedIdRef = useRef(null);

    // -----------------------------------------------------------------------
    // Load saved nodes from backend on mount
    // Merge with preset nodes: preset data takes priority for metadata,
    // but saved positions override the presets
    // -----------------------------------------------------------------------

    useEffect(() => {
        async function loadNodes() {
            try {
                const res = await fetch(`${API_BASE}/nodes`);
                const savedAll = await res.json();
                const saved = (Array.isArray(savedAll) ? savedAll : []).filter((row) => {
                    const rowDataspaceId = row?.metadata?.dataspaceId || 'demo';
                    return rowDataspaceId === dataspaceId;
                });

                if (saved.length === 0) {
                    // First run: persist the preset initial nodes to the backend
                    for (const [id, node] of Object.entries(initialNodes)) {
                        await fetch(`${API_BASE}/nodes`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                nodeId: id,
                                name: node.name,
                                x: node.x,
                                y: node.y,
                                metadata: {
                                    ...DEFAULT_METADATA,
                                    dataspaceId,
                                    bpn: node.bpn || '',
                                    location: node.location || '',
                                    domain: node.domain || '',
                                    ontologies: node.ontologies || [],
                                    dataCategories: node.dataCategories || [],
                                    formats: node.formats || [],
                                    tags: node.tags || [],
                                    roles: node.roles || { provider: true, consumer: true },
                                    dspEndpoint: node.dspEndpoint || '',
                                    catalogUrl: node.catalogUrl || '',
                                    // credentials for policy evaluation
                                    industry: node.metadata?.industry || '',
                                    orgRole: node.metadata?.orgRole || '',
                                }
                            })
                        });
                    }
                    setNodes(initialNodes);
                } else {
                    // Convert array from backend → { id: node } map
                    const fromBackend = {};
                    for (const row of saved) {
                        fromBackend[row.node_id] = {
                            x: row.x,
                            y: row.y,
                            name: row.name,
                            ...row.metadata,
                        };
                    }
                    setNodes(fromBackend);
                }
            } catch (err) {
                console.error('[useDragNodes] Failed to load nodes from backend:', err);
                setNodes(initialNodes);
            } finally {
                setLoaded(true);
            }
        }
        loadNodes();
    }, [dataspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Add node
    // -----------------------------------------------------------------------

    const addNode = useCallback(async (participantData) => {
        const name = typeof participantData === 'string' ? participantData : participantData.name;

        // Build normalized node data — always preserve bpn and credentials
        const nodeData = {
            ...DEFAULT_METADATA,
            ...(typeof participantData === 'object' ? participantData : {}),
            name,
            dataspaceId,
            // Flatten nested metadata if it came from NameDialog's { metadata: { industry, orgRole } }
            ...(participantData?.metadata || {}),
            // Ensure bpn is at root level
            bpn: participantData?.bpn || participantData?.metadata?.bpn || '',
        };

        const baseId = name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36);
        const id = dataspaceId === 'demo' ? baseId : `${dataspaceId}::${baseId}`;

        // Find best position on the ring
        const bestAngle = largestGapAngle(Object.values(nodes));
        const SPAWN_RADIUS = targetRadius;
        const x = Math.cos(bestAngle) * SPAWN_RADIUS;
        const y = Math.sin(bestAngle) * SPAWN_RADIUS;

        // Persist to backend — store full nodeData as metadata so bpn, industry, orgRole survive reload
        await fetch(`${API_BASE}/nodes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId: id, name, x, y, metadata: nodeData })
        });

        setNodes(prev => ({ ...prev, [id]: { x, y, ...nodeData } }));
        return id;
    }, [nodes, targetRadius, dataspaceId]);

    // -----------------------------------------------------------------------
    // Remove node
    // -----------------------------------------------------------------------

    const removeNode = useCallback(async (id) => {
        await fetch(`${API_BASE}/nodes/${id}`, { method: 'DELETE' });
        setNodes(prev => {
            const { [id]: removed, ...rest } = prev;
            return rest;
        });
    }, []);

    // -----------------------------------------------------------------------
    // Update node metadata
    // -----------------------------------------------------------------------

    const updateNode = useCallback(async (id, data) => {
        await fetch(`${API_BASE}/nodes/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metadata: data })
        });
        setNodes(prev => ({ ...prev, [id]: { ...prev[id], ...data } }));
    }, []);

    // -----------------------------------------------------------------------
    // Drag logic — position is saved to backend on drag-end only
    // -----------------------------------------------------------------------

    const handleDragStart = (id) => {
        setDraggedId(id);
        dragStartPosRef.current = nodes[id];
        draggedIdRef.current = id;
    };

    const handleDrag = (id, info) => {
        if (id !== draggedIdRef.current || !dragStartPosRef.current) return;
        const x = dragStartPosRef.current.x + info.offset.x;
        const y = dragStartPosRef.current.y + info.offset.y;
        const dist = Math.sqrt(x * x + y * y);
        const angleDeg = Math.atan2(y, x) * (180 / Math.PI);
        setNodes(prev => ({ ...prev, [id]: { ...prev[id], x, y } }));
        setDragState({ angle: angleDeg + 90, distance: dist });
        setIsSnapZone(Math.abs(dist - targetRadius) < SNAP_THRESHOLD);
    };

    const handleDragEnd = (id, info) => {
        if (isZoomed) return;
        setDraggedId(null);
        draggedIdRef.current = null;
        setDragState({ angle: 0, distance: 0 });
        setIsSnapZone(false);

        const startPos = dragStartPosRef.current;
        dragStartPosRef.current = null;
        if (!startPos) return;

        const dragged = { x: startPos.x + info.offset.x, y: startPos.y + info.offset.y };
        const dist = Math.sqrt(dragged.x * dragged.x + dragged.y * dragged.y);

        let finalPos = dragged;
        if (Math.abs(dist - targetRadius) < SNAP_THRESHOLD) {
            const angle = Math.atan2(dragged.y, dragged.x);
            finalPos = { x: Math.cos(angle) * targetRadius, y: Math.sin(angle) * targetRadius };
        }

        setNodes(prev => ({ ...prev, [id]: { ...prev[id], ...finalPos } }));

        // Persist position to backend
        fetch(`${API_BASE}/nodes/${id}/position`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalPos)
        }).catch(console.error);
    };

    // -----------------------------------------------------------------------
    // Derived helpers
    // -----------------------------------------------------------------------

    const getProviders = () =>
        Object.entries(nodes)
            .filter(([, n]) => n.roles?.provider)
            .map(([id, n]) => ({ id, ...n }));

    const filterNodes = (filters) =>
        Object.entries(nodes)
            .filter(([, n]) => {
                if (filters.domain && n.domain !== filters.domain) return false;
                if (filters.roles?.provider && !n.roles?.provider) return false;
                if (filters.roles?.consumer && !n.roles?.consumer) return false;
                return true;
            })
            .map(([id, n]) => ({ id, ...n }));

    return {
        nodes,
        setNodes,
        draggedId,
        isSnapZone,
        dragState,
        loaded,
        addNode,
        removeNode,
        updateNode,
        getProviders,
        filterNodes,
        handleDragStart,
        handleDrag,
        handleDragEnd,
    };
};

export default useDragNodes;
