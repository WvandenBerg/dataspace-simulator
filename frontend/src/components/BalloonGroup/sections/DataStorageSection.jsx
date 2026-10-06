import React, { useState } from 'react';
import { Package, Download, X, Pencil, Eye } from 'lucide-react';
import PublishAssetDialog from '../../PublishAssetDialog';
import AssetViewDialog from '../dialogs/AssetViewDialog';

const DataStorageSection = ({ assets, isConnected, onPublish, onDeleteAsset, onEditAsset, dataspaceId, isDemo = true, minimalView = false, fill = false }) => {
    const [editingAsset, setEditingAsset] = useState(null);
    const [viewingAsset, setViewingAsset] = useState(null);

    if (minimalView) {
        return null;
    }

    return (
        <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '0.75rem', paddingTop: '0.75rem', ...(fill ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : {}) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>
                    Data Storage
                </div>
                {isDemo && !minimalView && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onPublish(); }}
                        disabled={!isConnected}
                        style={{ padding: '6px 14px', background: '#f97316', border: 'none', borderRadius: '4px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}
                    >
                        + Publish Asset
                    </button>
                )}
            </div>

            {assets.length > 0 ? (
                <div onWheel={(e) => e.stopPropagation()} style={{ minHeight: '60px', ...(fill ? { flex: 1 } : { maxHeight: '120px' }), overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {assets.map((asset, i) => (
                        <div
                            key={asset.id || i}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(249, 115, 22, 0.1)', border: '1px solid rgba(249, 115, 22, 0.3)', borderRadius: '6px', fontSize: '0.75rem', color: '#ea580c' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', flex: 1 }}>
                                <Package size={12} />
                                <div style={{ overflow: 'hidden', flex: 1 }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                        {asset.name || asset.id}
                                    </span>
                                    {asset.type === 'received' && asset.from && (
                                        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>from {asset.from}</span>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setViewingAsset(asset); }}
                                    style={{ background: 'rgba(100,116,139,0.12)', border: '1px solid rgba(100,116,139,0.45)', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', fontSize: '0.65rem' }}
                                >
                                    <Eye size={10} style={{ marginRight: '2px' }} />
                                    View
                                </button>

                                {asset.type === 'received' && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const blob = new Blob([JSON.stringify(asset, null, 2)], { type: 'application/json' });
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = `${asset.name || 'asset'}.json`;
                                            a.click();
                                            URL.revokeObjectURL(url);
                                        }}
                                        style={{ background: 'rgba(34, 197, 94, 0.2)', border: '1px solid #22c55e', color: '#22c55e', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', fontSize: '0.65rem' }}
                                    >
                                        <Download size={10} style={{ marginRight: '2px' }} />
                                        Save
                                    </button>
                                )}

                                {asset.type !== 'received' && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setEditingAsset(asset); }}
                                        style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.45)', color: '#60a5fa', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', fontSize: '0.65rem' }}
                                    >
                                        <Pencil size={10} style={{ marginRight: '2px' }} />
                                        Edit
                                    </button>
                                )}

                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDeleteAsset(asset.id || asset.sourceId || asset['@id'] || i);
                                    }}
                                    style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', opacity: 0.7, transition: 'opacity 0.2s' }}
                                    onMouseEnter={(e) => e.target.style.opacity = 1}
                                    onMouseLeave={(e) => e.target.style.opacity = 0.7}
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div style={{ minHeight: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: 'var(--color-secondary-bg)', borderRadius: '6px', border: '1px dashed var(--color-secondary-light)' }}>
                    {[1, 2, 3].map(i => (
                        <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-secondary)', opacity: 0.5 }} />
                    ))}
                </div>
            )}

            {viewingAsset && (
                <AssetViewDialog asset={viewingAsset} dataspaceId={dataspaceId} onClose={() => setViewingAsset(null)} />
            )}

            <PublishAssetDialog
                isOpen={Boolean(editingAsset)}
                onClose={() => setEditingAsset(null)}
                onPublish={() => { }}
                mode="edit"
                initialAsset={editingAsset}
                dataspaceId={dataspaceId}
                onSaveAsset={async (payload) => {
                    if (!editingAsset?.id) return;
                    await onEditAsset?.(editingAsset.id, payload);
                    setEditingAsset(null);
                }}
            />
        </div>
    );
};

export default DataStorageSection;
