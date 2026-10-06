import React, { useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import AssetViewDialog from './BalloonGroup/dialogs/AssetViewDialog';
import { shortIri } from './catalogFields';

const API_BASE = '/api';

const labelStyle = { fontSize: '0.64rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' };
const sectionStyle = { ...labelStyle, fontWeight: 700, margin: '16px 0 4px' };
const mutedStyle = { fontSize: '0.7rem', color: 'var(--text-muted)' };
const rowStyle = { display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 0', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' };
const viewStyle = { padding: 0, background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-primary)' };

const SEVERITY_COLORS = { violation: '#dc2626', warning: '#d97706', info: '#64748b' };
const SEVERITY_RANK = { violation: 0, warning: 1, info: 2 };
const STATUS_COLORS = { conforms: '#16a34a', warnings: '#d97706', violations: '#dc2626' };

const Dot = ({ color }) => (
    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color, flexShrink: 0 }} />
);

// Every field of the profile, nodes included, since a finding can concern a node itself.
const fieldLabels = (fields, prefix = [], labels = [], out = new Map()) => {
    for (const f of fields) {
        const path = [...prefix, f.path];
        const label = [...labels, f.label];
        out.set(path.join(' '), label.join(' \u203a '));
        fieldLabels(f.fields || [], path, label, out);
    }
    return out;
};

const labelOf = (labels, path) => (path
    ? labels.get(path.join(' ')) || path.map(shortIri).join(' \u203a ')
    : 'Other constraints');

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const entriesText = (n) => (n === 1 ? '1 entry' : `${n} entries`);

const ViewButton = ({ onClick }) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} style={viewStyle}>
        View <ArrowUpRight size={11} />
    </button>
);

// A heading that hides what is under it until asked, so the tab opens on what matters.
const Fold = ({ title, children }) => {
    const [open, setOpen] = useState(false);
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
        <>
            <div onClick={() => setOpen(!open)} style={{ ...sectionStyle, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <Chevron size={12} /> {title}
            </div>
            {open && children}
        </>
    );
};

// One field that fails in one way: the count up front, the message and the entries on click.
const FindingGroup = ({ group, labels, titles, onView }) => {
    const [open, setOpen] = useState(false);
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
        <div>
            <div onClick={() => setOpen(!open)} style={rowStyle}>
                <Chevron size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                <Dot color={SEVERITY_COLORS[group.severity]} />
                <span style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{labelOf(labels, group.path)}</span>
                <span style={{ ...mutedStyle, whiteSpace: 'nowrap' }}>{entriesText(group.entries.size)}</span>
            </div>
            {open && (
                <div style={{ padding: '6px 0 8px 34px' }}>
                    <div style={labelStyle}>Message</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: '2px 0 8px' }}>{group.message}</div>
                    <div style={labelStyle}>{group.entries.size === 1 ? 'Entry' : 'Entries'}</div>
                    {[...group.entries].map((id) => (
                        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: '0.74rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titles.get(id) || id}</span>
                            <ViewButton onClick={() => onView({ datasetId: id, title: titles.get(id) })} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const byField = (entries) => {
    const groups = new Map();
    for (const entry of entries) {
        for (const f of entry.findings) {
            const key = `${f.severity}|${f.path?.join(' ') ?? ''}|${f.message}`;
            if (!groups.has(key)) groups.set(key, { ...f, entries: new Set() });
            groups.get(key).entries.add(entry.datasetId);
        }
    }
    return [...groups.values()].sort((a, b) => (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || (b.entries.size - a.entries.size));
};

const EntryRow = ({ entry, labels, onView }) => {
    const [open, setOpen] = useState(false);
    const counts = ['violation', 'warning', 'info']
        .map((s) => [s, entry.findings.filter((f) => f.severity === s).length])
        .filter(([, n]) => n > 0)
        .map(([s, n]) => plural(n, s));
    const Chevron = open ? ChevronDown : ChevronRight;

    return (
        <div style={{ borderBottom: '1px solid var(--border-color)', padding: '6px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span
                    onClick={() => entry.findings.length > 0 && setOpen(!open)}
                    style={{ display: 'flex', alignItems: 'center', gap: '7px', flex: 1, minWidth: 0, cursor: entry.findings.length > 0 ? 'pointer' : 'default' }}
                >
                    <Chevron size={12} color="var(--text-muted)" style={{ visibility: entry.findings.length > 0 ? 'visible' : 'hidden', flexShrink: 0 }} />
                    <Dot color={STATUS_COLORS[entry.status]} />
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.title || entry.datasetId}
                    </span>
                </span>
                <span style={{ ...mutedStyle, whiteSpace: 'nowrap' }}>{counts.length > 0 ? counts.join(', ') : 'conforms'}</span>
                <ViewButton onClick={() => onView(entry)} />
            </div>
            {open && (
                <div style={{ margin: '6px 0 2px 26px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {[...entry.findings]
                        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
                        .map((f, i) => (
                            <div key={i} style={{ display: 'flex', gap: '7px', alignItems: 'baseline' }}>
                                <Dot color={SEVERITY_COLORS[f.severity]} />
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-primary)' }}>{labelOf(labels, f.path)}</div>
                                    <div style={mutedStyle}>{f.message}</div>
                                    {f.value && <div style={{ ...mutedStyle, fontFamily: 'monospace', wordBreak: 'break-all' }}>{f.value}</div>}
                                </div>
                            </div>
                        ))}
                </div>
            )}
        </div>
    );
};

const ValidationTab = ({ dataspaceId, validation }) => {
    const { report, isRunning, error, run } = validation;
    const [model, setModel] = useState(null);
    const [viewing, setViewing] = useState(null);

    // The model names the fields; read again with each report, which may follow another profile.
    useEffect(() => {
        let cancelled = false;
        fetch(`${API_BASE}/dataspaces/${encodeURIComponent(dataspaceId)}/catalog-model`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => { if (!cancelled) setModel(data); })
            .catch(() => { if (!cancelled) setModel(null); });
        return () => { cancelled = true; };
    }, [dataspaceId, report?.ranAt]);

    const labels = model ? fieldLabels(model.fields) : new Map();
    const profileTitle = model?.profileId === report?.profileId ? model?.title : report?.profileId;
    const groups = report ? byField(report.entries) : [];
    const violations = groups.filter((g) => g.severity === 'violation');
    const others = groups.filter((g) => g.severity !== 'violation');
    const titles = new Map((report?.entries || []).map((e) => [e.datasetId, e.title]));
    const entries = report
        ? [...report.entries].sort((a, b) => ['violations', 'warnings', 'conforms'].indexOf(a.status) - ['violations', 'warnings', 'conforms'].indexOf(b.status))
        : [];
    const passing = report ? report.total - report.violations : 0;

    return (
        <div style={{ paddingTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={labelStyle}>Checked against</div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>{profileTitle || '\u2026'}</div>
                </div>
                <button
                    type="button"
                    onClick={run}
                    disabled={isRunning}
                    title={report ? `Last run ${new Date(report.ranAt).toLocaleTimeString()}` : undefined}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 10px', fontSize: '0.72rem', fontWeight: 600, borderRadius: '6px', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: isRunning ? 'default' : 'pointer', opacity: isRunning ? 0.6 : 1 }}
                >
                    <RefreshCw size={12} style={isRunning ? { animation: 'spin 1s linear infinite' } : undefined} />
                    {isRunning ? 'Validating...' : 'Run again'}
                </button>
            </div>

            {error && <div style={{ fontSize: '0.76rem', color: '#b45309', padding: '10px 0' }}>{error}</div>}
            {!report && !error && <div style={{ ...labelStyle, padding: '10px 0' }}>Validating the catalog...</div>}

            {report && (
                <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginTop: '14px' }}>
                        <span style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-primary)' }}>{passing}/{report.total}</span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>entries without violations</span>
                    </div>
                    <div style={{ height: '6px', marginTop: '6px', borderRadius: '3px', overflow: 'hidden', background: report.total > 0 ? '#dc2626' : 'var(--border-subtle)' }}>
                        <div style={{ width: `${report.total > 0 ? (passing / report.total) * 100 : 0}%`, height: '100%', background: '#16a34a', transition: 'width 0.6s ease' }} />
                    </div>

                    <div style={sectionStyle}>Violations</div>
                    {violations.length === 0 && <div style={{ ...mutedStyle, padding: '4px 0' }}>None. Every entry has what the profile requires.</div>}
                    {violations.map((g) => (
                        <FindingGroup key={`${g.path?.join(' ')}|${g.message}`} group={g} labels={labels} titles={titles} onView={setViewing} />
                    ))}

                    {others.length > 0 && (
                        <Fold title={`Warnings (${others.length})`}>
                            {others.map((g) => (
                                <FindingGroup key={`${g.severity}|${g.path?.join(' ')}|${g.message}`} group={g} labels={labels} titles={titles} onView={setViewing} />
                            ))}
                        </Fold>
                    )}

                    {entries.length > 0 && (
                        <Fold title={`All entries (${entries.length})`}>
                            {entries.map((entry) => (
                                <EntryRow key={entry.datasetId} entry={entry} labels={labels} onView={setViewing} />
                            ))}
                        </Fold>
                    )}
                    {entries.length === 0 && <div style={{ ...mutedStyle, marginTop: '12px' }}>The catalog has no entries.</div>}
                </>
            )}

            {viewing && (
                <AssetViewDialog
                    asset={{ id: viewing.datasetId, name: viewing.title }}
                    dataspaceId={dataspaceId}
                    onClose={() => setViewing(null)}
                />
            )}
        </div>
    );
};

export default ValidationTab;
