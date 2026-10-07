import React, { useState } from 'react';
import { Plus } from 'lucide-react';

// Checkboxes for the known values, and a field for one the list lacks.
const CredentialValues = ({ options, selected, onChange }) => {
    const [draft, setDraft] = useState('');
    const shown = [...new Set([...options, ...selected])];

    const toggle = (value) => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
    const add = () => {
        const value = draft.trim().toLowerCase();
        if (value && !selected.includes(value)) onChange([...selected, value]);
        setDraft('');
    };

    return (
        <div style={{ display: 'grid', gap: '4px' }}>
            {shown.map((o) => (
                <label key={o} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
                    {o}
                </label>
            ))}
            <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                    placeholder="Other..."
                    style={{ flex: 1, minWidth: 0, padding: '3px 6px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '5px', color: 'var(--text-primary)', fontSize: '0.76rem' }}
                />
                <button
                    type="button"
                    onClick={add}
                    disabled={!draft.trim()}
                    title="Add"
                    style={{ padding: '0 6px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '5px', color: 'var(--text-secondary)', cursor: draft.trim() ? 'pointer' : 'default', opacity: draft.trim() ? 1 : 0.5 }}
                >
                    <Plus size={12} />
                </button>
            </div>
        </div>
    );
};

export default CredentialValues;
