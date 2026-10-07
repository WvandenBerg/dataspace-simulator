import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import CredentialValues from '../../CredentialValues';
import { INDUSTRIES, ORG_ROLES, credentialOptions, toList } from '../../credentials';

const EditParticipantDialog = ({ show, participantData, name, bpn, allNodes = {}, onSave, onCancel }) => {
    const [industryValues, setIndustryValues] = useState([]);
    const [orgRoleValues, setOrgRoleValues] = useState([]);
    const [industryOpen, setIndustryOpen] = useState(false);
    const [orgRoleOpen, setOrgRoleOpen] = useState(false);

    useEffect(() => {
        if (!show) return;
        setIndustryValues(toList(participantData?.industry || participantData?.metadata?.industry));
        setOrgRoleValues(toList(participantData?.orgRole || participantData?.metadata?.orgRole));
        setIndustryOpen(false);
        setOrgRoleOpen(false);
    }, [show, participantData]);

    const formatSummary = (values) => {
        if (values.length === 0) return 'Select values';
        return values.join(', ');
    };

    const handleDialogClickCapture = (e) => {
        const target = e.target;
        if (target && target.closest && target.closest('[data-cred-dropdown="true"]')) return;
        setIndustryOpen(false);
        setOrgRoleOpen(false);
    };

    if (!show) return null;

    // Portalled out of the canvas, whose zoom would otherwise shrink it into the card.
    return createPortal(
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onPointerDown={(e) => e.stopPropagation()}
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
                zIndex: 2100,
            }}
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClickCapture={handleDialogClickCapture}
                onPointerDown={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                style={{
                    background: 'var(--bg-card)',
                    padding: '24px',
                    borderRadius: '12px',
                    border: '1px solid var(--border-subtle)',
                    width: '460px',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                    <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Edit Credentials</h3>
                    <button
                        onClick={onCancel}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div>
                        <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>Name</label>
                        <input
                            value={name || ''}
                            readOnly
                            style={{ width: '100%', padding: '8px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '0.9rem', boxSizing: 'border-box' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>DID</label>
                        <input
                            value={bpn || ''}
                            readOnly
                            style={{ width: '100%', padding: '8px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '0.85rem', fontFamily: 'monospace', boxSizing: 'border-box' }}
                        />
                    </div>

                    <div>
                        <div style={{ position: 'relative' }}>
                            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>Industry</label>
                            <button
                                type="button"
                                data-cred-dropdown="true"
                                onClick={() => {
                                    setIndustryOpen((v) => !v);
                                    setOrgRoleOpen(false);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                                style={{ width: '100%', textAlign: 'left', padding: '8px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.9rem', cursor: 'pointer' }}
                            >
                                {formatSummary(industryValues)}
                            </button>
                            {industryOpen && (
                                <div data-cred-dropdown="true" onPointerDown={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 20, border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '8px', background: 'var(--bg-card)', maxHeight: '220px', overflowY: 'auto', boxShadow: '0 10px 24px rgba(0,0,0,0.35)' }}>
                                    <CredentialValues options={credentialOptions(INDUSTRIES, Object.values(allNodes), 'industry')} selected={industryValues} onChange={setIndustryValues} />
                                </div>
                            )}
                        </div>
                    </div>

                    <div>
                        <div style={{ position: 'relative' }}>
                            <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '4px' }}>Org. Role</label>
                            <button
                                type="button"
                                data-cred-dropdown="true"
                                onClick={() => {
                                    setOrgRoleOpen((v) => !v);
                                    setIndustryOpen(false);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                                style={{ width: '100%', textAlign: 'left', padding: '8px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.9rem', cursor: 'pointer' }}
                            >
                                {formatSummary(orgRoleValues)}
                            </button>
                            {orgRoleOpen && (
                                <div data-cred-dropdown="true" onPointerDown={(e) => e.stopPropagation()} style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 20, border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '8px', background: 'var(--bg-card)', maxHeight: '220px', overflowY: 'auto', boxShadow: '0 10px 24px rgba(0,0,0,0.35)' }}>
                                    <CredentialValues options={credentialOptions(ORG_ROLES, Object.values(allNodes), 'orgRole')} selected={orgRoleValues} onChange={setOrgRoleValues} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                    <button
                        onClick={onCancel}
                        style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave({ industry: industryValues.join(','), orgRole: orgRoleValues.join(',') })}
                        style={{ padding: '8px 16px', background: '#3b82f6', border: 'none', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer' }}
                    >
                        Save
                    </button>
                </div>
            </motion.div>
        </motion.div>,
        document.body,
    );
};

export default EditParticipantDialog;
