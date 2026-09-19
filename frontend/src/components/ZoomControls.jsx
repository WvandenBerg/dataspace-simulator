import React from 'react';
import { Plus, Minus } from 'lucide-react';

import { ZOOM_MIN, ZOOM_MAX } from './hooks/useViewState';
import './Components.css';

/**
 * Zoom controls for the MacroView — an alternative to the scroll wheel.
 * Zooms around the canvas centre and shows the current zoom level.
 */
const ZoomControls = ({ scale, onZoomIn, onZoomOut }) => {
    // Keep clicks from reaching the container's pan handler
    const swallowPointerDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    return (
        <div className="zoom-controls" onPointerDown={swallowPointerDown}>
            <button
                type="button"
                className="zoom-controls-btn"
                onClick={onZoomIn}
                disabled={scale >= ZOOM_MAX}
                title="Zoom in"
                aria-label="Zoom in"
            >
                <Plus size={18} />
            </button>

            <div className="zoom-controls-level">{Math.round(scale * 100)}%</div>

            <button
                type="button"
                className="zoom-controls-btn"
                onClick={onZoomOut}
                disabled={scale <= ZOOM_MIN}
                title="Zoom out"
                aria-label="Zoom out"
            >
                <Minus size={18} />
            </button>
        </div>
    );
};

export default ZoomControls;
