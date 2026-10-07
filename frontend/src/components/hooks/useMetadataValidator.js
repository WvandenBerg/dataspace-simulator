import { useCallback, useEffect, useState } from 'react';

/**
 * Whether this dataspace runs a metadata validator, and what it last reported.
 *
 * The validator is a service of the Vocabulary Hub, checking the catalog against
 * the profile the hub holds, so it only runs while the hub does.
 */
const dataspaceUrl = (dataspaceId) => `/api/dataspaces/${encodeURIComponent(dataspaceId)}`;

const emptyState = (dataspaceId) => ({ dataspaceId, isEnabled: false, report: null, error: null, doneFor: null });

export function useMetadataValidator(dataspaceId, hubEnabled) {
    const [state, setState] = useState(() => emptyState(dataspaceId));
    const [request, setRequest] = useState(0);

    if (state.dataspaceId !== dataspaceId) {
        setState(emptyState(dataspaceId));
    }

    useEffect(() => {
        let cancelled = false;
        fetch(`${dataspaceUrl(dataspaceId)}/settings`)
            .then((r) => (r.ok ? r.json() : {}))
            .then((settings) => {
                if (!cancelled) setState((prev) => ({ ...prev, isEnabled: settings?.validator?.enabled === true }));
            })
            .catch(console.error);
        return () => { cancelled = true; };
    }, [dataspaceId]);

    const isActive = hubEnabled && state.isEnabled;
    // A run that finishes after a newer one was asked for is dropped by the effect's cleanup.
    const runKey = `${dataspaceId}|${isActive}|${request}`;

    useEffect(() => {
        if (!isActive) return undefined;
        let cancelled = false;
        fetch(`${dataspaceUrl(dataspaceId)}/validation`)
            .then(async (r) => {
                const body = await r.json();
                if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
                return body;
            })
            .then((report) => {
                if (!cancelled) setState((prev) => ({ ...prev, report, error: null, doneFor: runKey }));
            })
            .catch((err) => {
                if (!cancelled) setState((prev) => ({ ...prev, error: err.message, doneFor: runKey }));
            });
        return () => { cancelled = true; };
    }, [dataspaceId, isActive, runKey]);

    const run = useCallback(() => setRequest((n) => n + 1), []);

    const setEnabled = useCallback((next) => {
        fetch(`${dataspaceUrl(dataspaceId)}/settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ validator: { enabled: next } }),
        })
            // A report from before it was switched off may no longer hold.
            .then(() => setState((prev) => ({ ...prev, isEnabled: next, report: null, error: null })))
            .catch(console.error);
    }, [dataspaceId]);

    return {
        isEnabled: state.isEnabled,
        isActive,
        report: isActive ? state.report : null,
        error: isActive ? state.error : null,
        isRunning: isActive && state.doneFor !== runKey,
        run,
        setEnabled,
    };
}
