import { useState, useRef } from 'react';

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25; // factor per button click

const clampScale = (scale) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));

/**
 * Hook für Pan/Zoom-Steuerung der MacroView
 */
export const useViewState = (initialScale = 0.4) => {
    const [viewState, setViewState] = useState({ x: 0, y: -100, scale: initialScale });
    const [isPanning, setIsPanning] = useState(false);

    const handleWheel = (e, containerRef) => {
        const { x, y, scale } = viewState;
        const scaleChange = -e.deltaY * 0.0005; // Reduced from 0.001 for smoother zoom
        const newScale = clampScale(scale + scaleChange);
        const ratio = newScale / scale;

        const rect = containerRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;

        const newX = cx * (1 - ratio) + x * ratio;
        const newY = cy * (1 - ratio) + y * ratio;

        setViewState({ x: newX, y: newY, scale: newScale });
    };

    /**
     * Button zoom, anchored on the canvas centre rather than the cursor.
     * At the centre (cx = cy = 0) the wheel maths reduces to x * ratio.
     */
    const zoomBy = (factor) => {
        setViewState(prev => {
            const newScale = clampScale(prev.scale * factor);
            const ratio = newScale / prev.scale;
            return { x: prev.x * ratio, y: prev.y * ratio, scale: newScale };
        });
    };

    const zoomIn = () => zoomBy(ZOOM_STEP);
    const zoomOut = () => zoomBy(1 / ZOOM_STEP);

    const handlePanStart = (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        setIsPanning(true);

        const startX = e.clientX;
        const startY = e.clientY;
        const startViewX = viewState.x;
        const startViewY = viewState.y;

        const handlePanMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            setViewState(prev => ({ ...prev, x: startViewX + dx, y: startViewY + dy }));
        };

        const handlePanUp = () => {
            window.removeEventListener('pointermove', handlePanMove);
            window.removeEventListener('pointerup', handlePanUp);
            setIsPanning(false);
        };

        window.addEventListener('pointermove', handlePanMove);
        window.addEventListener('pointerup', handlePanUp);
    };

    return { viewState, setViewState, handleWheel, handlePanStart, isPanning, zoomIn, zoomOut };
};

export default useViewState;
