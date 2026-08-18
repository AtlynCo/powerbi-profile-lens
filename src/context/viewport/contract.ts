import type { ScenePoint, SceneTransform, Viewport } from "../contract";

export interface ContextCamera {
    readonly zoom: number;
    readonly panX: number;
    readonly panY: number;
}

export interface CameraLimits {
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly overscroll: number;
}

export interface SceneBounds {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
}

export interface ViewportProbe {
    readonly screen: ScenePoint;
    readonly scene: ScenePoint;
}

export interface ContextViewportSession {
    readonly sceneIdentity: string;
    readonly camera: ContextCamera;
    readonly baseTransform: SceneTransform;
    readonly baseBounds: SceneBounds;
    readonly viewport: Viewport;
    readonly invalidResize: boolean;
}

