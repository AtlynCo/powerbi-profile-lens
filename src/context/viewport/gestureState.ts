import type { ScenePoint, Viewport } from "../contract";

export const DRAG_THRESHOLD_PX = 4;
export const WHEEL_SETTLE_MS = 120;
export const KEYBOARD_ZOOM_FACTOR = 1.25;

export interface GesturePointer {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    readonly pointerType: string;
}

export function dragThresholdExceeded(start: ScenePoint, current: ScenePoint): boolean {
    return Math.hypot(current.x - start.x, current.y - start.y) >= DRAG_THRESHOLD_PX;
}

export function pointerMidpoint(
    first: GesturePointer,
    second: GesturePointer
): ScenePoint {
    return {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2
    };
}

export function pointerDistance(
    first: GesturePointer,
    second: GesturePointer
): number {
    return Math.max(Math.hypot(second.x - first.x, second.y - first.y), Number.EPSILON);
}

export function normalizeWheelDelta(
    deltaY: number,
    deltaMode: number,
    viewportHeight: number
): number {
    if (!Number.isFinite(deltaY) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
        throw new Error("Wheel normalization requires finite delta and positive viewport height.");
    }
    const pixels = deltaMode === 1
        ? deltaY * 16
        : deltaMode === 2
            ? deltaY * viewportHeight
            : deltaY;
    return Math.min(Math.max(pixels, -240), 240);
}

export function wheelZoomFactor(deltaPixels: number, sensitivity: number): number {
    if (
        !Number.isFinite(deltaPixels)
        || !Number.isFinite(sensitivity)
        || sensitivity <= 0
    ) {
        throw new Error("Wheel zoom requires finite delta and positive sensitivity.");
    }
    return Math.exp(-deltaPixels * sensitivity * 0.002);
}

export function keyboardPanStep(viewport: Viewport): number {
    if (
        !Number.isFinite(viewport.width)
        || !Number.isFinite(viewport.height)
        || viewport.width <= 0
        || viewport.height <= 0
    ) {
        throw new Error("Keyboard pan requires a finite positive viewport.");
    }
    return Math.min(Math.max(Math.min(viewport.width, viewport.height) * 0.1, 16), 64);
}
