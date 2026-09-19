import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ChevronLeft, Plus, Database, Trash2 } from 'lucide-react';

export default function DataspaceSidebar({
    dataspaces,
    activeDataspaceId,
    onSelect,
    onCreate,
    onDelete,
    collapsed,
    onToggle,
}) {
    const [draftName, setDraftName] = useState('');
    const [scenarios, setScenarios] = useState([]);
    const [scenarioId, setScenarioId] = useState('');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        fetch('/api/scenarios')
            .then((res) => res.json())
            .then((list) => setScenarios(Array.isArray(list) ? list : []))
            .catch(() => setScenarios([]));
    }, []);

    const active = useMemo(
        () => dataspaces.find((d) => d.id === activeDataspaceId),
        [dataspaces, activeDataspaceId]
    );

    const submitCreate = async () => {
        const trimmed = draftName.trim();
        if (!trimmed || creating) return;
        setCreating(true);
        try {
            await onCreate({
                name: trimmed,
                scenarioId,
                // Editable like the built-in dataspaces. isDemo: false models participants
                // owned by external connectors, which this standalone build never contacts.
                isDemo: true,
            });
            setDraftName('');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className={`dataspace-sidebar ${collapsed ? 'collapsed' : ''}`}>
            <button className="dataspace-sidebar-toggle" onClick={onToggle} title={collapsed ? 'Open sidebar' : 'Close sidebar'}>
                {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>

            {!collapsed && (
                <>
                    <div className="dataspace-sidebar-header">
                        <div className="dataspace-sidebar-title">Dataspaces</div>
                        <div className="dataspace-sidebar-subtitle">Session switcher</div>
                    </div>

                    <div className="dataspace-list">
                        {dataspaces.map((space) => {
                            const isActive = space.id === activeDataspaceId;
                            return (
                                <button
                                    key={space.id}
                                    className={`dataspace-item ${isActive ? 'active' : ''}`}
                                    onClick={() => onSelect(space.id)}
                                >
                                    <div className="dataspace-item-main">
                                        <Database size={13} />
                                        <span className="dataspace-item-name">{space.name}</span>
                                    </div>
                                    <div className="dataspace-item-right">
                                        {!space.isDemo && (
                                            <span
                                                className="dataspace-delete"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onDelete(space.id);
                                                }}
                                                title="Delete dataspace"
                                            >
                                                <Trash2 size={12} />
                                            </span>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="dataspace-create">
                        <input
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') submitCreate();
                            }}
                            placeholder="New dataspace name"
                            className="dataspace-create-input"
                        />
                        {scenarios.length > 0 && (
                            <select
                                value={scenarioId}
                                onChange={(e) => setScenarioId(e.target.value)}
                                className="dataspace-create-input"
                                title="Populate the new dataspace from a scenario"
                            >
                                <option value="">Empty dataspace</option>
                                {scenarios.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name} ({s.participantCount} participants, {s.assetCount} assets)
                                    </option>
                                ))}
                            </select>
                        )}
                        <button className="dataspace-create-btn" onClick={submitCreate} disabled={creating}>
                            <Plus size={13} /> {creating ? 'Creating…' : 'New'}
                        </button>
                    </div>

                    <div className="dataspace-active-note">
                        Active: <strong>{active?.name || 'n/a'}</strong>
                    </div>
                </>
            )}
        </div>
    );
}
