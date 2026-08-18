import { LIMITS } from "../model/contract";
import type { ContextRendererKind, ContextScene } from "./contract";

export interface RendererThresholds {
    readonly maxSvgFeatures: number;
    readonly maxSvgVertices: number;
}

export const DEFAULT_RENDERER_THRESHOLDS: RendererThresholds = {
    maxSvgFeatures: LIMITS.maxSvgContextFeatures,
    maxSvgVertices: LIMITS.maxSvgContextVertices
};

export function chooseContextRenderer(
    scene: ContextScene,
    thresholds: RendererThresholds = DEFAULT_RENDERER_THRESHOLDS
): ContextRendererKind {
    return scene.metrics.featureCount <= thresholds.maxSvgFeatures
        && scene.metrics.vertexCount <= thresholds.maxSvgVertices
        ? "svg"
        : "canvas";
}
