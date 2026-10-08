import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft, Plus, Database, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import DeleteConfirmDialog from './BalloonGroup/dialogs/DeleteConfirmDialog';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function DataspaceSidebar({
    dataspaces,
    activeDataspaceId,
    onSelect,
    onCreate,
    onRename,
    onDelete,
    collapsed,
    onToggle,
}) {
    const [draftName, setDraftName] = useState('');
    const [scenarios, setScenarios] = useState([]);
    const [scenarioId, setScenarioId] = useState('');
    const [creating, setCreating] = useState(false);
    const [menu, setMenu] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [renaming, setRenaming] = useState(null);
    const cancelRenameRef = useRef(false);
    const menuRef = useRef(null);

    useEffect(() => {
        if (!menu) return undefined;
        const close = (e) => {
            if (!menuRef.current?.contains(e.target)) setMenu(null);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [menu]);

    // Fixed rather than absolute: the scrolling list would clip the lower items' menus.
    const toggleMenu = (e, id) => {
        if (menu?.id === id) return setMenu(null);
        const rect = e.currentTarget.getBoundingClientRect();
        setMenu({ id, top: rect.bottom + 4, right: window.innerWidth - rect.right });
    };

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

    const selectedScenario = useMemo(
        () => scenarios.find((s) => s.id === scenarioId),
        [scenarios, scenarioId]
    );

    // Scenarios alphabetically, dataspaces without one last.
    const groups = useMemo(() => {
        const byKey = new Map();
        for (const space of dataspaces) {
            const key = space.scenarioId || '';
            if (!byKey.has(key)) {
                byKey.set(key, {
                    key,
                    title: space.scenario?.name || (key ? `Unknown scenario (${key})` : 'No scenario'),
                    description: space.scenario?.description || '',
                    spaces: [],
                });
            }
            byKey.get(key).spaces.push(space);
        }
        return [...byKey.values()].sort((a, b) => (a.key === '') - (b.key === '') || a.title.localeCompare(b.title));
    }, [dataspaces]);

    const submitCreate = async () => {
        const trimmed = draftName.trim();
        if (!trimmed || creating) return;
        setCreating(true);
        try {
            await onCreate({ name: trimmed, scenarioId });
            setDraftName('');
        } finally {
            setCreating(false);
        }
    };

    const startRename = (space) => {
        setMenu(null);
        setRenaming({ id: space.id, draft: space.name });
    };

    // Enter and Escape both blur, so saving happens in one place only.
    const finishRename = (space) => {
        const name = renaming.draft.trim();
        const cancelled = cancelRenameRef.current;
        cancelRenameRef.current = false;
        setRenaming(null);
        if (!cancelled && name && name !== space.name) onRename(space.id, name);
    };

    const askDelete = (space) => {
        setMenu(null);
        setConfirm({
            title: 'Delete dataspace?',
            message: <>This removes <strong>{space.name}</strong> with all its participants, assets, transfers and hub profiles. It cannot be undone.</>,
            confirmLabel: 'Delete',
            run: () => onDelete(space.id),
        });
    };

    const renderItem = (space) => (
        <div key={space.id} className={`dataspace-item ${space.id === activeDataspaceId ? 'active' : ''}`}>
            {renaming?.id === space.id ? (
                <input
                    className="dataspace-create-input dataspace-item-rename"
                    value={renaming.draft}
                    onChange={(e) => setRenaming({ ...renaming, draft: e.target.value })}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') cancelRenameRef.current = true;
                        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                    }}
                    onBlur={() => finishRename(space)}
                    maxLength={100}
                    autoFocus
                />
            ) : (
                <button className="dataspace-item-main" onClick={() => onSelect(space.id)}>
                    <Database size={13} />
                    <span className="dataspace-item-text">
                        <span className="dataspace-item-name">{space.name}</span>
                        <span className="dataspace-item-meta">
                            {plural(space.participants, 'participant')}, {plural(space.assets, 'asset')}
                        </span>
                    </span>
                </button>
            )}
            <div className="dataspace-item-menu" ref={menu?.id === space.id ? menuRef : null}>
                <button
                    className="dataspace-item-menu-btn"
                    onClick={(e) => toggleMenu(e, space.id)}
                    title="Dataspace actions"
                >
                    <MoreVertical size={14} />
                </button>
                {menu?.id === space.id && (
                    <div className="dataspace-menu" style={{ top: menu.top, right: menu.right }}>
                        <button className="dataspace-menu-item" onClick={() => startRename(space)}>
                            <Pencil size={13} /> Rename
                        </button>
                        <button className="dataspace-menu-item danger" onClick={() => askDelete(space)}>
                            <Trash2 size={13} /> Delete
                        </button>
                    </div>
                )}
            </div>
        </div>
    );

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

                    <div className="dataspace-list" onScroll={() => setMenu(null)}>
                        {groups.map((group) => (
                            <div key={group.key} className="dataspace-group">
                                <div className="dataspace-group-title" title={group.description}>{group.title}</div>
                                {group.spaces.map(renderItem)}
                            </div>
                        ))}
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
                                className="dataspace-create-select"
                                title="Populate the new dataspace from a scenario"
                            >
                                <option value="">Empty dataspace</option>
                                {scenarios.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>
                        )}
                        {selectedScenario && (
                            <div className="dataspace-create-hint">
                                {selectedScenario.participantCount} participants, {selectedScenario.assetCount} assets
                            </div>
                        )}
                        <button className="dataspace-create-btn" onClick={submitCreate} disabled={creating}>
                            <Plus size={13} /> {creating ? 'Creating…' : 'New dataspace'}
                        </button>
                    </div>

                    <div className="dataspace-active-note">
                        Active: <strong>{active?.name || 'n/a'}</strong>
                    </div>
                </>
            )}

            <DeleteConfirmDialog
                show={Boolean(confirm)}
                title={confirm?.title}
                message={confirm?.message}
                confirmLabel={confirm?.confirmLabel}
                onConfirm={() => {
                    confirm.run();
                    setConfirm(null);
                }}
                onCancel={() => setConfirm(null)}
            />
        </div>
    );
}
