import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import DatasetDetail from '../popups/DatasetDetail';

const API_BASE = '/api';

// Reads the stored asset rather than the card's copy, which carries no record.
const AssetViewDialog = ({ asset, dataspaceId, onClose }) => {
    const [loaded, setLoaded] = useState(null);
    const [model, setModel] = useState(null);
    const [error, setError] = useState(null);
    const assetId = asset.sourceId || asset.id;

    useEffect(() => {
        let cancelled = false;
        fetch(`${API_BASE}/assets/${encodeURIComponent(assetId)}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'This asset no longer exists' : `HTTP ${r.status}`))))
            .then((data) => { if (!cancelled) setLoaded(data); })
            .catch((err) => { if (!cancelled) setError(err.message); });
        fetch(`${API_BASE}/dataspaces/${encodeURIComponent(dataspaceId)}/catalog-model`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => { if (!cancelled) setModel(data); })
            .catch(() => { if (!cancelled) setModel(null); });
        return () => { cancelled = true; };
    }, [assetId, dataspaceId]);

    return createPortal(
        <div
            onMouseDown={onClose}
            // A portal still bubbles React events to the canvas, which zooms on wheel and click.
            onWheel={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
        >
            <div
                onMouseDown={(e) => e.stopPropagation()}
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: '20px', width: 'min(480px, 94vw)', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.45)' }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>{asset.name || assetId}</div>
                    <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={18} /></button>
                </div>
                {error && <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>{error}</div>}
                {!error && !loaded && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Loading...</div>}
                {loaded && <DatasetDetail dataset={loaded} dataspaceId={dataspaceId} model={model} />}
            </div>
        </div>,
        document.body,
    );
};

export default AssetViewDialog;
