import type {
    ContextFeature,
    ContextGeometry,
    ContextScene,
    ScenePoint,
    SceneTransform,
    Viewport
} from "./contract";

const PADDING = 8;

export function fitScene(scene: ContextScene, viewport: Viewport): SceneTransform {
    const points = scene.features.flatMap((feature) => geometryPoints(feature.geometry));
    if (points.length === 0) {
        return {
            scale: 1,
            translateX: viewport.width / 2,
            translateY: viewport.height / 2,
            invertY: false
        };
    }
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const width = Math.max(viewport.width - PADDING * 2, 1);
    const height = Math.max(viewport.height - PADDING * 2, 1);
    const scale = Math.min(width / spanX, height / spanY);
    const invertY = scene.mode === "points" || scene.mode === "boundGeometry";
    return {
        scale,
        translateX: PADDING + (width - spanX * scale) / 2 - minX * scale,
        translateY: invertY
            ? PADDING + (height - spanY * scale) / 2 + maxY * scale
            : PADDING + (height - spanY * scale) / 2 - minY * scale,
        invertY
    };
}

export function projectPoint(point: ScenePoint, transform: SceneTransform): ScenePoint {
    return {
        x: point.x * transform.scale + transform.translateX,
        y: transform.invertY
            ? transform.translateY - point.y * transform.scale
            : point.y * transform.scale + transform.translateY
    };
}

export function geometryPoints(geometry: ContextGeometry): readonly ScenePoint[] {
    if (geometry.points) {
        return geometry.points;
    }
    return (geometry.polygons ?? []).flatMap((polygon) => polygon.flatMap((ring) => ring));
}

export function projectedCenter(feature: ContextFeature, transform: SceneTransform): ScenePoint {
    return projectPoint(feature.geometry.center, transform);
}
