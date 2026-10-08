import React, { useState } from 'react';
import { createPortal } from 'react-dom';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function NewDataspaceDialog({ scenarios, onCreate, onClose }) {
    const [name, setName] = useState('');
    const [scenarioId, setScenarioId] = useState('');
    const [creating, setCreating] = useState(false);

    const options = [
        { id: '', name: 'Empty dataspace', description: 'No participants or assets. Add them yourself.' },
        ...scenarios,
    ];

    // A name the user has not typed follows the chosen scenario.
    const choose = (option) => {
        const previous = options.find((o) => o.id === scenarioId);
        if (!name.trim() || name === previous?.name) setName(option.id ? option.name : '');
        setScenarioId(option.id);
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!name.trim() || creating) return;
        setCreating(true);
        try {
            await onCreate({ name: name.trim(), scenarioId });
            onClose();
        } finally {
            setCreating(false);
        }
    };

    return createPortal(
        <div className="dialog-overlay" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
            <form className="dialog-content new-dataspace-dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
                <h3>New dataspace</h3>
                <input
                    className="dataspace-create-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name"
                    maxLength={100}
                    autoFocus
                />
                <div className="scenario-cards-label">Start from</div>
                <div className="scenario-cards">
                    {options.map((option) => (
                        <button
                            key={option.id || 'empty'}
                            type="button"
                            className={`scenario-card ${option.id === scenarioId ? 'selected' : ''}`}
                            onClick={() => choose(option)}
                        >
                            <span className="scenario-card-title">{option.name}</span>
                            {option.description && <span className="scenario-card-desc">{option.description}</span>}
                            {option.id && (
                                <span className="scenario-card-meta">
                                    {plural(option.participantCount, 'participant')}, {plural(option.assetCount, 'asset')}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="dialog-actions">
                    <button type="button" className="dialog-btn cancel" onClick={onClose}>Cancel</button>
                    <button type="submit" className="dialog-btn confirm" disabled={!name.trim() || creating}>
                        {creating ? 'Creating…' : 'Create'}
                    </button>
                </div>
            </form>
        </div>,
        document.body,
    );
}
