import { useMotionValue, useTransform } from 'framer-motion';

/**
 * Hook für Wire-Path-Berechnungen im ConnectorNode
 * Berechnet einen einzelnen neutralen Draht zum vereinigten Balloon-Box
 */
export const useWirePaths = (springRotation, balloonDistance = 350, offset = null) => {
    const noOffset = useMotionValue(0);
    const offsetX = offset?.x ?? noOffset;
    const offsetY = offset?.y ?? noOffset;
    const balloonAngleRad = useTransform(springRotation, r => (r * Math.PI) / 180);
    const balloonX = useTransform([balloonAngleRad, offsetX], ([rad, dx]) => Math.cos(rad) * balloonDistance + dx);
    const balloonY = useTransform([balloonAngleRad, offsetY], ([rad, dy]) => Math.sin(rad) * balloonDistance + dy);

    const connectorAnchor = { x: 0, y: 0 };

    // Einzelner Draht zur Mitte der vereinigten Box
    const wirePath = useTransform([balloonX, balloonY], ([bx, by]) => {
        // Draht geht zur Mitte der Box
        const boxAnchorX = bx;
        const boxAnchorY = by;

        // Sanfte Kurve für natürliches Aussehen
        const cpX = bx * 0.4;
        const cpY = by * 0.4;

        return `M ${connectorAnchor.x} ${connectorAnchor.y} Q ${cpX} ${cpY}, ${boxAnchorX} ${boxAnchorY}`;
    });

    // Legacy support: wire1Path und wire2Path zeigen auf denselben Pfad
    // für Abwärtskompatibilität mit Animationen
    const wire1Path = wirePath;
    const wire2Path = wirePath;

    return { balloonX, balloonY, wirePath, wire1Path, wire2Path };
};

export default useWirePaths;

