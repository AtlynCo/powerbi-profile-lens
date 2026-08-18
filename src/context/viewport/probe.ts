import type { SceneTransform, Viewport } from "../contract";
import { inverseProjectPoint } from "./camera";
import type { ViewportProbe } from "./contract";

export function centerProbe(viewport: Viewport, effectiveTransform: SceneTransform): ViewportProbe {
    if (
        !Number.isFinite(viewport.width)
        || !Number.isFinite(viewport.height)
        || viewport.width <= 0
        || viewport.height <= 0
    ) {
        throw new Error("Center probe requires a finite positive viewport.");
    }
    const screen = {
        x: viewport.width / 2,
        y: viewport.height / 2
    };
    return {
        screen,
        scene: inverseProjectPoint(screen, effectiveTransform)
    };
}

