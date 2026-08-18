import type { ContextFeature, ContextHit, ContextScene, ScenePoint, SceneTransform } from "./contract";
import { projectPoint } from "./projection";

export function hitTestScene(
    scene: ContextScene,
    transform: SceneTransform,
    x: number,
    y: number,
    pointRadius = 7
): ContextHit | null {
    for (let index = scene.features.length - 1; index >= 0; index--) {
        const feature = scene.features[index];
        if (containsFeature(feature, transform, { x, y }, pointRadius)) {
            return { featureIndex: feature.index, featureKey: feature.key };
        }
    }
    return null;
}

function containsFeature(
    feature: ContextFeature,
    transform: SceneTransform,
    point: ScenePoint,
    pointRadius: number
): boolean {
    const geometry = feature.geometry;
    if (geometry.points) {
        return geometry.points.some((candidate) => {
            const projected = projectPoint(candidate, transform);
            return Math.hypot(projected.x - point.x, projected.y - point.y) <= pointRadius;
        });
    }
    for (const polygon of geometry.polygons ?? []) {
        if (polygon.length === 0) {
            continue;
        }
        const outer = polygon[0].map((entry) => projectPoint(entry, transform));
        if (!pointInRing(point, outer)) {
            continue;
        }
        const inHole = polygon.slice(1).some((ring) =>
            pointInRing(point, ring.map((entry) => projectPoint(entry, transform))));
        if (!inHole) {
            return true;
        }
    }
    return false;
}

function pointInRing(point: ScenePoint, ring: readonly ScenePoint[]): boolean {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
        const currentPoint = ring[index];
        const previousPoint = ring[previous];
        const crosses = (currentPoint.y > point.y) !== (previousPoint.y > point.y)
            && point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)
                / ((previousPoint.y - currentPoint.y) || Number.EPSILON) + currentPoint.x;
        if (crosses) {
            inside = !inside;
        }
    }
    return inside;
}

export function encodeFeatureColor(index: number): readonly [number, number, number] {
    const value = index + 1;
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function decodeFeatureColor(red: number, green: number, blue: number): number | null {
    const value = (red << 16) | (green << 8) | blue;
    return value === 0 ? null : value - 1;
}
