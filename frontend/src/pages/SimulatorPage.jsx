import React, { useState, useRef, useEffect } from 'react';
import MacroView from '../components/MacroView';
import TopBar from '../components/TopBar';
import NameDialog from '../components/NameDialog';
import PublishAssetDialog from '../components/PublishAssetDialog';
import DataspaceSidebar from '../components/DataspaceSidebar';

import '../components/Components.css';


// Use relative URL so Vite proxy (dev) and nginx (prod) both work
const API_BASE = '/api';
const LEGACY_DATASPACES_KEY = 'simulator.dataspaces';

async function fetchDataspaces() {
    const res = await fetch(`${API_BASE}/dataspaces`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// The names used to live only in this browser; hand them to the backend once.
async function importLegacyDataspaces() {
    const raw = localStorage.getItem(LEGACY_DATASPACES_KEY);
    if (!raw) return;
    let legacy = [];
    try { legacy = JSON.parse(raw); } catch { /* unreadable: nothing to import */ }
    const known = new Map((await fetchDataspaces()).map((d) => [d.id, d]));
    for (const old of Array.isArray(legacy) ? legacy : []) {
        if (!old?.id || !old?.name) continue;
        const row = known.get(old.id);
        if (!row) {
            await fetch(`${API_BASE}/dataspaces`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: old.id, name: old.name }),
            });
        } else if (row.name === row.id && old.name !== row.id) {
            await fetch(`${API_BASE}/dataspaces/${encodeURIComponent(old.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: old.name }),
            });
        }
    }
    localStorage.removeItem(LEGACY_DATASPACES_KEY);
}


function SimulatorPage() {
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    }, []);

    // View State
    const [activeConnector, setActiveConnector] = useState(null);
    const [simulationState, setSimulationState] = useState('idle');
    const [minimalView, setMinimalView] = useState(false);

    // Data State - logs keyed by node ID
    const [logs, setLogs] = useState({});
    const [catalog, setCatalog] = useState([]);

    // Dialog State
    const [dialogOpen, setDialogOpen] = useState(false);
    const [publishDialogOpen, setPublishDialogOpen] = useState(false);
    const [publishingNodeId, setPublishingNodeId] = useState(null);
    const [publishingNodeName, setPublishingNodeName] = useState('');




    // Animation States
    const [discoveryPulse, setDiscoveryPulse] = useState(false);
    const [controlPlaneGlow, setControlPlaneGlow] = useState(null);
    const [ringLight, setRingLight] = useState(null);
    const [dataPlaneConnection, setDataPlaneConnection] = useState(null);
    const [dataTransfer, setDataTransfer] = useState(null);

    const [dataspaces, setDataspaces] = useState([]);
    const [dataspacesLoaded, setDataspacesLoaded] = useState(false);
    const [chosenDataspaceId, setActiveDataspaceId] = useState(() => localStorage.getItem('simulator.activeDataspaceId') || '');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('simulator.sidebarCollapsed') === '1');

    // A chosen dataspace that no longer exists falls back to the first one.
    const activeDataspace = dataspaces.find((d) => d.id === chosenDataspaceId) || dataspaces[0] || null;
    const activeDataspaceId = activeDataspace?.id || '';

    const refreshDataspaces = async () => {
        setDataspaces(await fetchDataspaces());
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                await importLegacyDataspaces();
                const list = await fetchDataspaces();
                if (!cancelled) setDataspaces(list);
            } catch (err) {
                console.error('Dataspaces could not be loaded:', err);
            } finally {
                if (!cancelled) setDataspacesLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        localStorage.setItem('simulator.activeDataspaceId', chosenDataspaceId);
    }, [chosenDataspaceId]);

    useEffect(() => {
        localStorage.setItem('simulator.sidebarCollapsed', sidebarCollapsed ? '1' : '0');
    }, [sidebarCollapsed]);

    const macroViewRef = useRef(null);

    const addLog = (msg, nodeId = 'system') => {
        const timestamp = `[${new Date().toLocaleTimeString()}] ${msg}`;
        setLogs(prev => ({
            ...prev,
            [nodeId]: [timestamp, ...(prev[nodeId] || [])]
        }));
    };

    const handleConnectorClick = (id) => {
        setActiveConnector(id);
    };

    const handleRequestContract = async (asset, provider, consumerNodeId) => {
        // Animation handling
    };

    const runContractAnimation = async (consumerNodeId, providerNodeId, asset) => {
        addLog(`Negotiating: ${asset?.name || 'Asset'}`, consumerNodeId);
        setSimulationState('negotiating');

        // Beide Control Planes gleichzeitig aufleuchten lassen
        setControlPlaneGlow([
            { nodeId: consumerNodeId, intensity: 1, type: 'controlPlane' },
            { nodeId: providerNodeId, intensity: 1, type: 'controlPlane' }
        ]);

        await new Promise(resolve => setTimeout(resolve, 2500));
        addLog('Contract Signed', consumerNodeId);

        // Control Plane Glow ausschalten
        setControlPlaneGlow(null);

        setDataPlaneConnection({ fromNodeId: providerNodeId, toNodeId: consumerNodeId, building: true });
        await new Promise(resolve => setTimeout(resolve, 2000));
        setDataPlaneConnection({ fromNodeId: providerNodeId, toNodeId: consumerNodeId, building: false, established: true });

        addLog('Transferring...', consumerNodeId);
        setSimulationState('transferring');
        setDataTransfer({ fromNodeId: providerNodeId, toNodeId: consumerNodeId, active: true });

        await new Promise(resolve => setTimeout(resolve, 3000));

        addLog('Data Received', consumerNodeId);

        // Alle States zurücksetzen
        setDataTransfer(null);
        setDataPlaneConnection(null);
        setSimulationState('idle');

        // Sicheres Zurücksetzen mit kurzer Verzögerung
        await new Promise(resolve => setTimeout(resolve, 100));
    };

    const handleAction = async (action, payload, nodeId) => {
        if (action === 'publish_asset') {
            setPublishingNodeId(nodeId);
            // Look up the actual node name from MacroView
            const nodes = macroViewRef.current?.nodes || {};
            setPublishingNodeName(nodes[nodeId]?.name || '');
            setPublishDialogOpen(true);

        } else if (action === 'request_transfer') {
            addLog(`Requesting: ${payload['name'] || payload['@id']}`, nodeId);
            setSimulationState('negotiating');

            setTimeout(() => {
                addLog('Contract Signed', nodeId);
                setSimulationState('transferring');

                setTimeout(() => {
                    addLog('Data Received', nodeId);
                    setSimulationState('idle');
                }, 5000);
            }, 2000);
        }
    };

    const handlePublishAsset = async (assetData) => {
        const nodeId = publishingNodeId;
        addLog(`Publishing: ${assetData.name}`, nodeId);

        try {
            const res = await fetch(`${API_BASE}/assets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nodeId,
                    dataspaceId: activeDataspaceId,
                    asset: {
                        name: assetData.name,
                        description: assetData.description || '',
                        content: assetData.content ?? '',
                        fileName: assetData.fileName || '',
                        policyId: assetData.policyId || null,
                        dcatFields: assetData.dcatFields || {},
                    }
                })
            });
            const data = await res.json();

            addLog(`\u2713 Asset '${assetData.name}' published!`, nodeId);

            if (macroViewRef.current?.addAsset && nodeId) {
                macroViewRef.current.addAsset(nodeId, {
                    id: data.assetId,
                    name: assetData.name,
                    description: assetData.description || '',
                    content: assetData.content ?? '',
                    fileName: assetData.fileName || '',
                    policyId: assetData.policyId || null,
                    dcatFields: assetData.dcatFields || {},
                    policy: assetData.policyId || 'open',
                    type: assetData.policyId || 'open',
                    publishedAt: new Date().toISOString()
                });
            }

            return data;
        } catch (err) {
            addLog(`✗ Publish failed: ${err.message}`, nodeId);
            console.error('Publish failed:', err);
        }
    };

    const openAddDialog = () => {
        setDialogOpen(true);
    };

    const handleAddNode = (participantData) => {
        if (macroViewRef.current) {
            macroViewRef.current.addNode(participantData);
        }
        setDialogOpen(false);
    };

    // In simulator, we don't create real dataspaces
    const handleSelectDataspace = (id) => {
        setActiveDataspaceId(id);
        setActiveConnector(null);
    };

    // The backend loads the scenario before answering, so MacroView mounts on a filled dataspace.
    const handleCreateDataspace = async ({ name, scenarioId = '' }) => {
        try {
            const res = await fetch(`${API_BASE}/dataspaces`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, scenarioId: scenarioId || null }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
            if (data.loaded) {
                addLog(`Scenario loaded: ${data.loaded.participants} participant(s), ${data.loaded.assetsAdded} asset(s)`);
            }
            await refreshDataspaces();
            setActiveDataspaceId(data.dataspace.id);
            setActiveConnector(null);
            addLog(`Dataspace created: ${name}`);
        } catch (err) {
            addLog(`Dataspace could not be created: ${err.message}`);
        }
    };

    const handleDeleteDataspace = async (id) => {
        const name = dataspaces.find((d) => d.id === id)?.name || id;
        try {
            const res = await fetch(`${API_BASE}/dataspaces/${encodeURIComponent(id)}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
            addLog(`Dataspace deleted: ${name}`);
        } catch (err) {
            addLog(`Dataspace could not be deleted: ${err.message}`);
        }
        if (id === activeDataspaceId) setActiveConnector(null);
        await refreshDataspaces();
    };

    const handleResetDemo = async () => {
        try {
            const keepAssets = activeDataspaceId === 'demo';
            await fetch(`${API_BASE}/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataspaceId: activeDataspaceId,
                    keepNodes: false,
                    keepAssets,
                })
            });
            window.location.reload();
        } catch (error) {
            console.error('Reset failed:', error);
        }
    };


    return (
        <div className="app-container simulator-page" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            <TopBar
                onAddParticipant={openAddDialog}
                onReset={handleResetDemo}
                onPolicies={() => { }}

                isDemo={true}
                title="Dataspace Simulator"
            />


            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
                <DataspaceSidebar
                    dataspaces={dataspaces}
                    activeDataspaceId={activeDataspaceId}
                    onSelect={handleSelectDataspace}
                    onCreate={handleCreateDataspace}
                    onDelete={handleDeleteDataspace}
                    collapsed={sidebarCollapsed}
                    onToggle={() => setSidebarCollapsed((v) => !v)}
                />
                {activeDataspace && <MacroView
                    key={activeDataspaceId}
                    ref={macroViewRef}
                    dataspaceId={activeDataspaceId}
                    onConnectorClick={handleConnectorClick}
                    activeConnector={activeConnector}
                    simulationState={simulationState}
                    onAction={handleAction}
                    logs={logs}
                    catalog={catalog}
                    discoveryPulse={discoveryPulse}
                    onDiscoveryPulse={setDiscoveryPulse}
                    controlPlaneGlow={controlPlaneGlow}
                    setControlPlaneGlow={setControlPlaneGlow}
                    ringLight={ringLight}
                    setRingLight={setRingLight}
                    dataPlaneConnection={dataPlaneConnection}
                    setDataPlaneConnection={setDataPlaneConnection}
                    dataTransfer={dataTransfer}
                    setDataTransfer={setDataTransfer}
                    onRequestContract={handleRequestContract}
                    runContractAnimation={runContractAnimation}
                    minimalView={minimalView}
                />}
                {dataspacesLoaded && !activeDataspace && (
                    <div className="dataspace-empty">No dataspaces. Create one in the sidebar.</div>
                )}
            </div>



            <NameDialog
                isOpen={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onConfirm={handleAddNode}
                existingNodes={macroViewRef.current?.nodes || {}}
            />

            {publishDialogOpen && (
                <PublishAssetDialog
                    isOpen
                    onClose={() => {
                        setPublishDialogOpen(false);
                        setPublishingNodeId(null);
                    }}
                    onPublish={handlePublishAsset}
                    participantName={publishingNodeName}
                    dataspaceId={activeDataspaceId}
                />
            )}
        </div>
    );
}

export default SimulatorPage;

