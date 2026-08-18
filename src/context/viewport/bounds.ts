import type { ContextScene, ScenePoint, SceneTransform, Viewport } from "../contract";
import type { ContextCamera, SceneBounds } from "./contract";

export const FIT_PADDING = 8;
export const MAX_OVERSCROLL = 24;

export function sceneBounds(scene: ContextScene): SceneBounds | null {
    let bounds: SceneBounds | null = null;
    for (const feature of scene.features) {
        if (feature.geometry.points) {
            for (const point of feature.geometry.points) {
                bounds = extendBounds(bounds, point);
            }
        }
        for (const polygon of feature.geometry.polygons ?? []) {
            for (const ring of polygon) {
                for (const point of ring) {
                    bounds = extendBounds(bounds, point);
                }
            }
        }
    }
    return bounds;
}

export function projectBounds(bounds: SceneBounds, transform: SceneTransform): SceneBounds {
    const first = project({ x: bounds.minX, y: bounds.minY }, transform);
    const second = project({ x: bounds.maxX, y: bounds.maxY }, transform);
    return {
        minX: Math.min(first.x, second.x),
        maxX: Math.max(first.x, second.x),
        minY: Math.min(first.y, second.y),
        maxY: Math.max(first.y, second.y)
    };
}

export function viewportOverscroll(viewport: Viewport): number {
    assertViewport(viewport);
    return Math.min(
        MAX_OVERSCROLL,
        Math.max(FIT_PADDING, Math.min(viewport.width, viewport.height) * 0.1)
    );
}

export function clampCameraToBounds(
    camera: ContextCamera,
    baseBounds: SceneBounds,
    viewport: Viewport,
    overscroll: number
): ContextCamera {
    assertCamera(camera);
    assertBounds(baseBounds);
    assertViewport(viewport);
    if (!Number.isFinite(overscroll) || overscroll < 0) {
        throw new Error("Viewport overscroll must be a finite non-negative number.");
    }
    return {
        ...camera,
        panX: clampAxis(
            camera.panX,
            baseBounds.minX,
            baseBounds.maxX,
            camera.zoom,
            viewport.width,
            overscroll
        ),
        panY: clampAxis(
            camera.panY,
            baseBounds.minY,
            baseBounds.maxY,
            camera.zoom,
            viewport.height,
            overscroll
        )
    };
}

function extendBounds(bounds: SceneBounds | null, point: ScenePoint): SceneBounds {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new Error("Context scene bounds require finite coordinates.");
    }
    if (!bounds) {
        return { minX: point.x, maxX: point.x, minY: point.y, maxY: point.y };
    }
    return {
        minX: Math.min(bounds.minX, point.x),
        maxX: Math.max(bounds.maxX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxY: Math.max(bounds.maxY, point.y)
    };
}

function project(point: ScenePoint, transform: SceneTransform): ScenePoint {
    assertTransform(transform);
    return {
        x: point.x * transform.scale + transform.translateX,
        y: transform.invertY
            ? transform.translateY - point.y * transform.scale
            : point.y * transform.scale + transform.translateY
    };
}

function clampAxis(
    pan: number,
    min: number,
    max: number,
    zoom: number,
    viewportSize: number,
    overscroll: number
): number {
    const lower = viewportSize - overscroll - max * zoom;
    const upper = overscroll - min * zoom;
    if (lower <= upper) {
        return Math.min(Math.max(pan, lower), upper);
    }
    return viewportSize / 2 - ((min + max) / 2) * zoom;
}

function assertBounds(bounds: SceneBounds): void {
    if (
        !Number.isFinite(bounds.minX)
        || !Number.isFinite(bounds.maxX)
        || !Number.isFinite(bounds.minY)
        || !Number.isFinite(bounds.maxY)
        || bounds.minX > bounds.maxX
        || bounds.minY > bounds.maxY
    ) {
        throw new Error("Scene bounds must be finite and ordered.");
    }
}

function assertCamera(camera: ContextCamera): void {
    if (
        !Number.isFinite(camera.zoom)
        || camera.zoom <= 0
        || !Number.isFinite(camera.panX)
        || !Number.isFinite(camera.panY)
    ) {
        throw new Error("Context camera must be finite with positive zoom.");
    }
}

function assertViewport(viewport: Viewport): void {
    if (
        !Number.isFinite(viewport.width)
        || !Number.isFinite(viewport.height)
        || viewport.width <= 0
        || viewport.height <= 0
    ) {
        throw new Error("Context viewport must have finite positive dimensions.");
    }
}

function assertTransform(transform: SceneTransform): void {
    if (
        !Number.isFinite(transform.scale)
        || transform.scale <= 0
        || !Number.isFinite(transform.translateX)
        || !Number.isFinite(transform.translateY)
    ) {
        throw new Error("Scene transform must be finite with positive scale.");
    }
}

