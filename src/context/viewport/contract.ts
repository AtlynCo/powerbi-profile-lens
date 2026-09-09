import type { ScenePoint, SceneTransform, Viewport } from "../contract";

export interface ContextCamera {
    readonly zoom: number;
    readonly panX: number;
    readonly panY: number;
}

export type CameraBoundary = "scene" | "probe";

export type CameraHomeView = "automatic" | "fit" | "fill";
export type ResolvedCameraHomeView = Exclude<CameraHomeView, "automatic">;

/**
 * Where Home places the fixed centre probe.
 *
 * "dataBearing" centres on a bound Entity that has loaded profile detail, so the probe opens on a
 * populated profile instead of the geometric centre of the whole context, which for a fitted world
 * map is open ocean. "sceneCenter" is the historical geometric behaviour and stays reachable.
 */
export type CameraHomeFocus = "automatic" | "dataBearing" | "sceneCenter";
export type ResolvedCameraHomeFocus = Exclude<CameraHomeFocus, "automatic">;

export interface ContextPinchSnapshot {
    readonly baseAnchor: ScenePoint;
    readonly zoom: number;
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
    readonly boundary: CameraBoundary;
    readonly homeZoom: number;
    readonly homeView: ResolvedCameraHomeView;
    readonly homeFocus: ResolvedCameraHomeFocus;
    /** Base-space point Home centres on, or null when Home uses the geometric scene centre. */
    readonly homeAnchor: ScenePoint | null;
    readonly baseTransform: SceneTransform;
    readonly baseBounds: SceneBounds;
    readonly viewport: Viewport;
    readonly invalidResize: boolean;
}
