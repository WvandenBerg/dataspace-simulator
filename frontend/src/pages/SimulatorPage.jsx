import React, { useState, useRef, useEffect } from 'react';
import MacroView from '../components/MacroView';
import TopBar from '../components/TopBar';
import NameDialog from '../components/NameDialog';
import PublishAssetDialog from '../components/PublishAssetDialog';
import DataspaceSidebar from '../components/DataspaceSidebar';

import '../components/Components.css';


// Use relative URL so Vite proxy (dev) and nginx (prod) both work
const API_BASE = '/api';


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
    const [catalogRequestLine, setCatalogRequestLine] = useState(null);
    const [ringLight, setRingLight] = useState(null);
    const [dataPlaneConnection, setDataPlaneConnection] = useState(null);
    const [dataTransfer, setDataTransfer] = useState(null);

    // System dataspaces
    const SYSTEM_DATASPACES = [
        {
            id: 'simulator',
            code: 'SIM',
            name: 'Simulator',
            participants: 3,
            isDemo: true,
            locked: true,
        },
        {
            id: 'demo',
            code: 'DEMO',
            name: 'Demo',
            participants: 3,
            isDemo: true,
            locked: true,
        }
    ];

    // Multi-Dataspace State
    const [dataspaces, setDataspaces] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('simulator.dataspaces') || '[]');
            if (Array.isArray(saved) && saved.length > 0) {
                const merged = [...saved];
                for (const systemSpace of SYSTEM_DATASPACES) {
                    const idx = merged.findIndex((d) => d.id === systemSpace.id);
                    if (idx === -1) {
                        merged.unshift(systemSpace);
                    } else {
                        merged[idx] = { ...merged[idx], ...systemSpace, locked: true, isDemo: true };
                    }
                }
                return merged;
            }
        } catch (_) { }
        return SYSTEM_DATASPACES;
    });
    const [activeDataspaceId, setActiveDataspaceId] = useState(() => localStorage.getItem('simulator.activeDataspaceId') || 'simulator');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('simulator.sidebarCollapsed') === '1');

    useEffect(() => {
        localStorage.setItem('simulator.dataspaces', JSON.stringify(dataspaces));
    }, [dataspaces]);

    useEffect(() => {
        localStorage.setItem('simulator.activeDataspaceId', activeDataspaceId);
    }, [activeDataspaceId]);

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

    const handleViewCatalog = async (provider) => {
        setControlPlaneGlow({ nodeId: provider.id, intensity: 1 });
        if (activeConnector) {
            setCatalogRequestLine({ from: activeConnector, to: provider.id });
        }
        setTimeout(() => {
            setControlPlaneGlow(null);
            setCatalogRequestLine(null);
        }, 3000);
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

    const handleCreateDataspace = async ({ name, isDemo = false, scenarioId = '' }) => {
        const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
        let participants = 0;

        // Load before switching. MacroView seeds its own participants when the
        // backend reports none for a dataspace, so the scenario has to be in
        // place before that mount happens.
        if (scenarioId) {
            try {
                const res = await fetch(`/api/scenarios/${encodeURIComponent(scenarioId)}/load`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dataspaceId: id }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const result = await res.json();
                participants = result.participants;
                addLog(`Scenario loaded: ${participants} participant(s), ${result.assetsAdded} asset(s)`);
            } catch (err) {
                addLog(`Scenario could not be loaded: ${err.message}`);
            }
        }

        const next = {
            id,
            name,
            participants,
            isDemo,
        };
        setDataspaces((prev) => [...prev, next]);
        setActiveDataspaceId(id);
        setActiveConnector(null);
        addLog(`Dataspace created: ${name}`);
    };

    const handleDeleteDataspace = (id) => {
        if (id === 'demo' || id === 'simulator') return;
        setDataspaces((prev) => prev.filter((d) => d.id !== id));
        if (activeDataspaceId === id) {
            setActiveDataspaceId('simulator');
            setActiveConnector(null);
        }
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


    const activeDataspace = dataspaces.find(ds => ds.id === activeDataspaceId);

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
                <MacroView
                    key={activeDataspaceId}
                    ref={macroViewRef}
                    dataspaceId={activeDataspaceId}
                    isDemo={Boolean(activeDataspace?.isDemo)}
                    onConnectorClick={handleConnectorClick}
                    activeConnector={activeConnector}
                    simulationState={simulationState}
                    onAction={handleAction}
                    logs={logs}
                    catalog={catalog}
                    catalogRequestLine={catalogRequestLine}
                    onViewCatalog={handleViewCatalog}
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
                />
            </div>



            <NameDialog
                isOpen={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onConfirm={handleAddNode}
                existingNodes={macroViewRef.current?.nodes || {}}
            />

            <PublishAssetDialog
                isOpen={publishDialogOpen}
                onClose={() => {
                    setPublishDialogOpen(false);
                    setPublishingNodeId(null);
                }}
                onPublish={handlePublishAsset}
                participantName={publishingNodeName}

            />
        </div>
    );
}

export default SimulatorPage;

