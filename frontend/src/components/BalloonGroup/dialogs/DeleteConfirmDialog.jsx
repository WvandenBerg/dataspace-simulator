import React from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';

const DeleteConfirmDialog = ({ show, name, onConfirm, onCancel }) => {
    if (!show) return null;

    return (
        <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0,0,0,0.7)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 1000
            }}
        >
            <Motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                style={{
                    background: 'var(--bg-card)',
                    padding: '24px',
                    borderRadius: '12px',
                    border: '1px solid var(--border-subtle)',
                    maxWidth: '400px',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                }}
            >
                <h3 style={{ margin: '0 0 16px 0', color: 'var(--text-primary)' }}>Delete Participant?</h3>
                <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
                    Are you sure you want to remove <strong style={{ color: 'var(--text-secondary)' }}>{name}</strong> from the Dataspace?
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button
                        onClick={onCancel}
                        style={{
                            padding: '8px 16px',
                            background: 'transparent',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            color: 'var(--text-muted)',
                            cursor: 'pointer'
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        style={{
                            padding: '8px 16px',
                            background: '#ef4444',
                            border: 'none',
                            borderRadius: '6px',
                            color: 'var(--text-primary)',
                            cursor: 'pointer'
                        }}
                    >
                        Delete
                    </button>
                </div>
            </Motion.div>
        </Motion.div>
    );
};

export default DeleteConfirmDialog;
