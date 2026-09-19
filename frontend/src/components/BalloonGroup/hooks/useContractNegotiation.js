import { useState, useRef } from 'react';

const API_BASE = '/api';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// A provider card carries whatever identifier the view it came from had to hand,
// while /api/catalog filters on node id only.
const resolveProviderNodeId = (provider, allNodes) => {
    if (provider?.id && allNodes?.[provider.id]) return provider.id;
    const bpn = String(provider?.bpn || '').toLowerCase();
    if (!bpn) return provider?.id || '';
    const match = Object.entries(allNodes || {})
        .find(([, node]) => String(node?.bpn || '').toLowerCase() === bpn);
    return match ? match[0] : (provider?.id || '');
};

const catalogAssetType = (dataset) => {
    const fields = dataset?.dcatFields || {};
    const distribution = (fields.distributions || [])[0] || {};
    const declaredFormat = (fields.additionalDcat || [])
        .find(entry => entry?.key === 'dct:format')?.value;
    const extension = String(dataset?.fileName || '').split('.').pop();
    return distribution.format || distribution.mediaType || declaredFormat
        || (extension && extension !== dataset?.fileName ? extension.toUpperCase() : '')
        || 'JSON';
};

const toCatalogAsset = (dataset) => ({
    id: dataset['@id'],
    sourceId: dataset['@id'],
    name: dataset.name || dataset['@id'],
    description: dataset.description || '',
    type: catalogAssetType(dataset),
    ownerNodeId: dataset.ownerNodeId,
    ownerName: dataset.ownerName,
    policyId: dataset.policyId,
    policyName: dataset.policyName,
    publishedAt: dataset.publishedAt,
    dcatFields: dataset.dcatFields || {},
});

export const useContractNegotiation = ({
    currentNodeId,
    allNodes,
    onLocalSearchChange,
    setControlPlaneGlow,
    setRingLight,
    setDataPlaneConnection,
    setDataTransfer,
    onDiscoveryPulse,
    onAddAsset,
    onRequestContract
}) => {
    const dataspaceId = String(allNodes?.[currentNodeId]?.dataspaceId || 'demo');
    const [isSearchingLocal, setIsSearchingLocal] = useState(false);
    const [selectedProvider, setSelectedProvider] = useState(null);
    const [providerAssets, setProviderAssets] = useState([]);
    const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
    const [negotiationState, setNegotiationState] = useState('idle');
    const [negotiationStatusText, setNegotiationStatusText] = useState('');
    const [negotiationProtocolState, setNegotiationProtocolState] = useState('');
    const [currentNegotiatingAsset, setCurrentNegotiatingAsset] = useState(null);
    const [negotiatingProvider, setNegotiatingProvider] = useState(null);
    const [currentNegotiationId, setCurrentNegotiationId] = useState(null);
    const cachedSearchResultsRef = useRef(null);

    const handleSearch = async (filters, setSearchResults) => {
        setIsSearchingLocal(true);

        onLocalSearchChange('toConnector');
        await new Promise(resolve => setTimeout(resolve, 1500));

        onLocalSearchChange('controlPlaneGlow');
        await new Promise(resolve => setTimeout(resolve, 500));

        await new Promise(resolve => setTimeout(resolve, 800));

        onDiscoveryPulse(true);
        await new Promise(resolve => setTimeout(resolve, 1000));
        onDiscoveryPulse(false);

        onLocalSearchChange('controlPlaneGlow');
        await new Promise(resolve => setTimeout(resolve, 500));

        onLocalSearchChange('toUI');
        await new Promise(resolve => setTimeout(resolve, 1500));

        onLocalSearchChange(false);

        const results = Object.entries(allNodes)
            .filter(([id, node]) => {
                if (id === currentNodeId) return false;

                const dist = Math.sqrt(node.x * node.x + node.y * node.y);
                const targetRadius = 550 + 60;
                const isConnected = Math.abs(dist - targetRadius) < 20;
                if (!isConnected) return false;

                if (!node.roles?.provider) return false;

                if (filters.location && node.location &&
                    !node.location.toLowerCase().includes(filters.location.toLowerCase())) {
                    return false;
                }
                if (filters.domain && node.domain && node.domain !== filters.domain) {
                    return false;
                }
                if (filters.ontologies.length > 0 && node.ontologies) {
                    const hasMatch = filters.ontologies.some(o => node.ontologies.includes(o));
                    if (!hasMatch) return false;
                }

                return true;
            })
            .map(([id, node]) => ({ id, ...node }));

        setSearchResults(results);
        cachedSearchResultsRef.current = results;
        setIsSearchingLocal(false);
    };

    const handleViewProviderCatalog = async (provider) => {
        setSelectedProvider(provider);
        setIsLoadingCatalog(true);
        setProviderAssets([]);

        onLocalSearchChange('toConnector');
        await new Promise(resolve => setTimeout(resolve, 1500));

        onLocalSearchChange('controlPlaneGlow');
        await new Promise(resolve => setTimeout(resolve, 500));
        onLocalSearchChange(false);

        setRingLight({ fromNodeId: currentNodeId, toNodeId: provider.id, building: true });
        await new Promise(resolve => setTimeout(resolve, 1500));

        setRingLight({ fromNodeId: currentNodeId, toNodeId: provider.id, established: true });
        setControlPlaneGlow({ nodeId: provider.id, intensity: 1 });
        await new Promise(resolve => setTimeout(resolve, 500));
        setControlPlaneGlow(null);

        setRingLight({ fromNodeId: currentNodeId, toNodeId: provider.id, returning: true });
        await new Promise(resolve => setTimeout(resolve, 1500));
        setRingLight(null);

        onLocalSearchChange('controlPlaneGlow');
        await new Promise(resolve => setTimeout(resolve, 500));

        onLocalSearchChange('toUI');
        await new Promise(resolve => setTimeout(resolve, 1500));

        onLocalSearchChange(false);

        try {
            const providerNodeId = resolveProviderNodeId(provider, allNodes);
            const query = new URLSearchParams({ dataspaceId, consumerNodeId: currentNodeId });
            if (providerNodeId) query.set('providerNodeId', providerNodeId);

            const response = await fetch(`${API_BASE}/catalog?${query}`);
            if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);

            const datasets = await response.json();
            setProviderAssets((Array.isArray(datasets) ? datasets : []).map(toCatalogAsset));
        } catch (error) {
            console.error('Failed to fetch catalog:', error);
            setProviderAssets([]);
        }

        setIsLoadingCatalog(false);
    };

    const handleBackToProviders = () => {
        setSelectedProvider(null);
        setProviderAssets([]);
    };

    const startNegotiation = async (asset, provider, options = {}) => {
        const autoTransfer = Boolean(options?.autoTransfer);
        setCurrentNegotiatingAsset(asset);
        setNegotiatingProvider(provider);
        setNegotiationState('connecting');
        setNegotiationStatusText('Establishing Connection...');
        setNegotiationProtocolState('');

        onLocalSearchChange('toConnector');
        await sleep(1000);

        onLocalSearchChange('controlPlaneGlow');
        setNegotiationStatusText('Connecting to Provider...');
        await sleep(800);
        onLocalSearchChange(false);

        setRingLight({ fromNodeId: currentNodeId, toNodeId: provider.id, building: true });
        setNegotiationStatusText('Building Control Plane Connection...');
        await sleep(1500);

        setRingLight({ fromNodeId: currentNodeId, toNodeId: provider.id, established: true });
        setNegotiationState('negotiating');
        setNegotiationStatusText('Submitting Contract Request...');
        await sleep(800);

        let negotiationId = null;
        try {
            const providerNodeId = provider?.id || provider?.bpn;
            const assetId = asset?.sourceId || asset?.id;
            const negotiateRes = await fetch(`${API_BASE}/negotiate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataspaceId,
                    consumerNodeId: currentNodeId,
                    providerNodeId,
                    assetId,
                })
            });
            const negotiateData = await negotiateRes.json();
            if (!negotiateRes.ok || !negotiateData.success) {
                throw new Error(negotiateData.error || 'Negotiation failed to start');
            }

            negotiationId = negotiateData.negotiationId;
            setCurrentNegotiationId(negotiationId);

            let status = negotiateData.status;
            let denialReason = negotiateData.denialReason;
            setNegotiationProtocolState(status || 'REQUESTED');

            for (let i = 0; i < 12 && status !== 'AGREED' && status !== 'TERMINATED'; i += 1) {
                setNegotiationStatusText(status === 'OFFERED' ? 'Offer Received...' : 'Waiting for Provider Offer...');
                await sleep(750);
                const statusRes = await fetch(`${API_BASE}/negotiate/${negotiationId}`);
                if (!statusRes.ok) continue;
                const statusData = await statusRes.json();
                status = statusData.status;
                denialReason = statusData.denial_reason || denialReason;
                setNegotiationProtocolState(status || 'REQUESTED');
            }

            if (status !== 'AGREED') {
                setNegotiationProtocolState(status || 'TERMINATED');
                setNegotiationStatusText(`Denied: ${denialReason || 'Policy check failed'}`);
                await sleep(1400);
                setRingLight(null);
                setControlPlaneGlow(null);
                resetNegotiationState();
                return;
            }
        } catch (error) {
            setNegotiationStatusText(`Negotiation failed: ${error.message}`);
            await sleep(1400);
            setRingLight(null);
            setControlPlaneGlow(null);
            resetNegotiationState();
            return;
        }

        setControlPlaneGlow({ nodeId: provider.id, intensity: 1 });
        setNegotiationStatusText('Negotiating Terms...');
        await sleep(700);

        setNegotiationStatusText('Signing Contract...');
        await sleep(600);
        setControlPlaneGlow(null);

        setNegotiationState('success');
        setNegotiationProtocolState('AGREED');
        setNegotiationStatusText('Contract Signed');

        if (autoTransfer) {
            await sleep(450);
            await startTransfer({
                negotiationId: negotiationId,
                provider,
                asset,
            });
        }
    };

    const startTransfer = async (overrides = {}) => {
        const effectiveAsset = overrides.asset || currentNegotiatingAsset;
        const effectiveProvider = overrides.provider || negotiatingProvider;
        const effectiveNegotiationId = overrides.negotiationId || currentNegotiationId;
        if (!effectiveAsset || !effectiveProvider || !effectiveNegotiationId) return;

        setNegotiationState('transferring');
        setNegotiationStatusText('Initiating Transfer...');

        const provider = effectiveProvider;
        let asset = effectiveAsset;

        try {
            const sourceId = asset?.sourceId || asset?.id;
            if (sourceId) {
                const detailRes = await fetch(`${API_BASE}/assets/${encodeURIComponent(sourceId)}`);
                if (detailRes.ok) {
                    const detail = await detailRes.json();
                    asset = {
                        ...asset,
                        sourceId,
                        content: detail.content ?? asset.content ?? '',
                        fileName: detail.fileName || asset.fileName || '',
                        dcatFields: detail.dcatFields || asset.dcatFields || {},
                    };
                }
            }
        } catch (_) {
            // keep transfer flow robust if detail fetch fails
        }

        setRingLight(null);
        await sleep(300);

        setControlPlaneGlow({ nodeId: provider.id, intensity: 1, type: 'dataPlaneGlow' });
        setNegotiationStatusText('Establishing Data Plane...');

        onLocalSearchChange('dataPlaneGlow');

        setDataPlaneConnection({ fromNodeId: provider.id, toNodeId: currentNodeId, building: true });
        await sleep(2000);

        setDataPlaneConnection({ fromNodeId: provider.id, toNodeId: currentNodeId, established: true });
        setNegotiationStatusText('Transferring Data...');

        setControlPlaneGlow({ nodeId: provider.id, intensity: 1, type: 'dataWire', direction: 'toConnector' });
        await sleep(1500);

        setControlPlaneGlow({ nodeId: provider.id, intensity: 1, type: 'dataPlaneGlow' });

        try {
            const transferRes = await fetch(`${API_BASE}/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataspaceId,
                    negotiationId: effectiveNegotiationId,
                    consumerNodeId: currentNodeId,
                })
            });
            const transferData = await transferRes.json();
            if (!transferRes.ok || !transferData.success) {
                throw new Error(transferData.error || 'Transfer failed');
            }
        } catch (error) {
            setNegotiationStatusText(`Transfer failed: ${error.message}`);
            setDataTransfer(null);
            setDataPlaneConnection(null);
            setControlPlaneGlow(null);
            onLocalSearchChange(false);
            await sleep(1500);
            resetNegotiationState();
            return;
        }

        setDataTransfer({ fromNodeId: provider.id, toNodeId: currentNodeId, active: true });
        await sleep(2200);
        setDataTransfer(null);

        onLocalSearchChange('dataToStorage');
        setNegotiationStatusText('Saving Asset...');
        await sleep(900);

        onAddAsset({
            ...asset,
            id: `${asset.id || 'asset'}-${Date.now()}`, // Always unique ID
            sourceId: asset.sourceId || asset.id, // Keep original ID for reference
            type: 'received',
            from: provider.name || provider.id,
            receivedAt: new Date().toISOString()
        });

        setNegotiationStatusText('Transfer Complete');
        setDataPlaneConnection(null);
        setControlPlaneGlow(null);
        onLocalSearchChange(false);

        await sleep(1200);
        setNegotiationState('idle');
        setNegotiationStatusText('');
        setNegotiationProtocolState('');
        setCurrentNegotiatingAsset(null);
        setNegotiatingProvider(null);
        setCurrentNegotiationId(null);

        onRequestContract(asset, provider, currentNodeId);
    };

    const resetNegotiationState = () => {
        setNegotiationState('idle');
        setNegotiationStatusText('');
        setNegotiationProtocolState('');
        setCurrentNegotiatingAsset(null);
        setNegotiatingProvider(null);
        setCurrentNegotiationId(null);
    };

    return {
        isSearchingLocal,
        selectedProvider,
        providerAssets,
        isLoadingCatalog,
        negotiationState,
        negotiationStatusText,
        negotiationProtocolState,
        currentNegotiatingAsset,
        negotiatingProvider,
        cachedSearchResultsRef,
        handleSearch,
        handleViewProviderCatalog,
        handleBackToProviders,
        startNegotiation,
        startTransfer,
        resetNegotiationState
    };
};
