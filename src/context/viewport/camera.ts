import type { ContextMode, ScenePoint, SceneTransform, Viewport } from "../contract";
import { clampCameraToBounds, FIT_PADDING } from "./bounds";
import type {
    CameraHomeView,
    CameraLimits,
    ContextCamera,
    ContextPinchSnapshot,
    ResolvedCameraHomeView,
    SceneBounds
} from "./contract";

export const DEFAULT_CAMERA: ContextCamera = {
    zoom: 1,
    panX: 0,
    panY: 0
};

export function composeSceneTransform(
    base: SceneTransform,
    camera: ContextCamera
): SceneTransform {
    assertTransform(base);
    assertCamera(camera);
    return {
        scale: base.scale * camera.zoom,
        translateX: base.translateX * camera.zoom + camera.panX,
        translateY: base.translateY * camera.zoom + camera.panY,
        invertY: base.invertY
    };
}

export function projectPoint(point: ScenePoint, transform: SceneTransform): ScenePoint {
    assertPoint(point);
    assertTransform(transform);
    return {
        x: point.x * transform.scale + transform.translateX,
        y: transform.invertY
            ? transform.translateY - point.y * transform.scale
            : point.y * transform.scale + transform.translateY
    };
}

export function inverseProjectPoint(point: ScenePoint, transform: SceneTransform): ScenePoint {
    assertPoint(point);
    assertTransform(transform);
    return {
        x: (point.x - transform.translateX) / transform.scale,
        y: transform.invertY
            ? (transform.translateY - point.y) / transform.scale
            : (point.y - transform.translateY) / transform.scale
    };
}

export function cameraToBasePoint(point: ScenePoint, camera: ContextCamera): ScenePoint {
    assertPoint(point);
    assertCamera(camera);
    return {
        x: (point.x - camera.panX) / camera.zoom,
        y: (point.y - camera.panY) / camera.zoom
    };
}

export function resetCamera(
    homeZoom: number,
    limits: CameraLimits,
    baseBounds: SceneBounds,
    viewport: Viewport
): ContextCamera {
    assertFinite(homeZoom, "Home zoom");
    assertLimits(limits);
    const zoom = Math.min(Math.max(homeZoom, limits.minZoom), limits.maxZoom);
    return clampCameraToBounds({
        zoom,
        panX: viewport.width / 2 - ((baseBounds.minX + baseBounds.maxX) / 2) * zoom,
        panY: viewport.height / 2 - ((baseBounds.minY + baseBounds.maxY) / 2) * zoom
    }, baseBounds, viewport, limits.overscroll);
}

export function resolveCameraHomeView(
    requested: CameraHomeView,
    mode: ContextMode,
    navigationEnabled: boolean
): ResolvedCameraHomeView {
    return requested === "automatic"
        ? (
            navigationEnabled
            && (mode === "builtInPack" || mode === "points" || mode === "boundGeometry")
                ? "fill"
                : "fit"
        )
        : requested;
}

export function homeZoomForBounds(
    homeView: ResolvedCameraHomeView,
    limits: CameraLimits,
    baseBounds: SceneBounds,
    viewport: Viewport
): number {
    assertLimits(limits);
    if (!validBounds(baseBounds) || !validViewport(viewport)) {
        throw new Error("Home zoom requires valid bounds and viewport.");
    }
    if (homeView === "fit") {
        return limits.minZoom;
    }
    const usableWidth = Math.max(viewport.width - FIT_PADDING * 2, 1);
    const usableHeight = Math.max(viewport.height - FIT_PADDING * 2, 1);
    const spanX = baseBounds.maxX - baseBounds.minX;
    const spanY = baseBounds.maxY - baseBounds.minY;
    const fillRatios = [
        spanX > Number.EPSILON ? usableWidth / spanX : null,
        spanY > Number.EPSILON ? usableHeight / spanY : null
    ].filter((ratio): ratio is number => ratio !== null);
    const fillZoom = fillRatios.length > 0 ? Math.max(...fillRatios) : limits.minZoom;
    return Math.min(Math.max(fillZoom, limits.minZoom), limits.maxZoom);
}

export function panCamera(
    camera: ContextCamera,
    deltaX: number,
    deltaY: number,
    limits: CameraLimits,
    baseBounds: SceneBounds,
    viewport: Viewport
): ContextCamera {
    assertCamera(camera);
    assertFinite(deltaX, "Camera pan delta X");
    assertFinite(deltaY, "Camera pan delta Y");
    assertLimits(limits);
    return clampCameraToBounds({
        ...camera,
        panX: camera.panX + deltaX,
        panY: camera.panY + deltaY
    }, baseBounds, viewport, limits.overscroll);
}

export function zoomCameraAt(
    camera: ContextCamera,
    factor: number,
    anchor: ScenePoint,
    limits: CameraLimits,
    baseBounds: SceneBounds,
    viewport: Viewport
): ContextCamera {
    assertCamera(camera);
    assertFinite(factor, "Camera zoom factor");
    if (factor <= 0) {
        throw new Error("Camera zoom factor must be positive.");
    }
    assertPoint(anchor);
    assertLimits(limits);
    const baseAnchor = cameraToBasePoint(anchor, camera);
    const zoom = Math.min(Math.max(camera.zoom * factor, limits.minZoom), limits.maxZoom);
    if (zoom === camera.zoom) {
        return clampCameraToBounds(camera, baseBounds, viewport, limits.overscroll);
    }
    return clampCameraToBounds({
        zoom,
        panX: anchor.x - baseAnchor.x * zoom,
        panY: anchor.y - baseAnchor.y * zoom
    }, baseBounds, viewport, limits.overscroll);
}

export function cameraForPinch(
    baseAnchor: ScenePoint,
    midpoint: ScenePoint,
    zoom: number,
    limits: CameraLimits,
    baseBounds: SceneBounds,
    viewport: Viewport
): ContextCamera {
    assertPoint(baseAnchor);
    assertPoint(midpoint);
    assertFinite(zoom, "Pinch zoom");
    assertLimits(limits);
    const clampedZoom = Math.min(Math.max(zoom, limits.minZoom), limits.maxZoom);
    return clampCameraToBounds({
        zoom: clampedZoom,
        panX: midpoint.x - baseAnchor.x * clampedZoom,
        panY: midpoint.y - baseAnchor.y * clampedZoom
    }, baseBounds, viewport, limits.overscroll);
}

export function createPinchSnapshot(
    camera: ContextCamera,
    midpoint: ScenePoint
): ContextPinchSnapshot {
    assertCamera(camera);
    assertPoint(midpoint);
    return {
        baseAnchor: cameraToBasePoint(midpoint, camera),
        zoom: camera.zoom
    };
}

export function cameraFromPinchSnapshot(
    snapshot: ContextPinchSnapshot,
    distanceRatio: number,
    midpoint: ScenePoint,
    limits: CameraLimits,
    baseBounds: SceneBounds,
    viewport: Viewport
): ContextCamera {
    assertPoint(snapshot.baseAnchor);
    assertFinite(snapshot.zoom, "Pinch snapshot zoom");
    if (snapshot.zoom <= 0) {
        throw new Error("Pinch snapshot zoom must be positive.");
    }
    assertFinite(distanceRatio, "Pinch distance ratio");
    if (distanceRatio <= 0) {
        throw new Error("Pinch distance ratio must be positive.");
    }
    return cameraForPinch(
        snapshot.baseAnchor,
        midpoint,
        snapshot.zoom * distanceRatio,
        limits,
        baseBounds,
        viewport
    );
}

export function preserveCameraOnResize(
    camera: ContextCamera,
    oldBase: SceneTransform,
    newBase: SceneTransform,
    oldViewport: Viewport,
    newViewport: Viewport,
    newBaseBounds: SceneBounds,
    limits: CameraLimits
): ContextCamera | null {
    if (
        !validCamera(camera)
        || !validTransform(oldBase)
        || !validTransform(newBase)
        || !validViewport(oldViewport)
        || !validViewport(newViewport)
        || !validLimits(limits)
        || !validBounds(newBaseBounds)
    ) {
        return null;
    }
    const sceneCenter = inverseProjectPoint({
        x: oldViewport.width / 2,
        y: oldViewport.height / 2
    }, composeSceneTransform(oldBase, camera));
    const newBaseCenter = projectPoint(sceneCenter, newBase);
    if (
        !Number.isFinite(sceneCenter.x)
        || !Number.isFinite(sceneCenter.y)
        || !Number.isFinite(newBaseCenter.x)
        || !Number.isFinite(newBaseCenter.y)
    ) {
        return null;
    }
    const zoom = Math.min(Math.max(camera.zoom, limits.minZoom), limits.maxZoom);
    return clampCameraToBounds({
        zoom,
        panX: newViewport.width / 2 - newBaseCenter.x * zoom,
        panY: newViewport.height / 2 - newBaseCenter.y * zoom
    }, newBaseBounds, newViewport, limits.overscroll);
}

export function cameraEquals(left: ContextCamera, right: ContextCamera): boolean {
    return left.zoom === right.zoom
        && left.panX === right.panX
        && left.panY === right.panY;
}

function assertPoint(point: ScenePoint): void {
    assertFinite(point.x, "Scene point X");
    assertFinite(point.y, "Scene point Y");
}

function assertCamera(camera: ContextCamera): void {
    assertFinite(camera.zoom, "Camera zoom");
    if (camera.zoom <= 0) {
        throw new Error("Camera zoom must be positive.");
    }
    assertFinite(camera.panX, "Camera pan X");
    assertFinite(camera.panY, "Camera pan Y");
}

function assertLimits(limits: CameraLimits): void {
    assertFinite(limits.minZoom, "Minimum zoom");
    assertFinite(limits.maxZoom, "Maximum zoom");
    assertFinite(limits.overscroll, "Camera overscroll");
    if (
        limits.minZoom <= 0
        || limits.maxZoom < limits.minZoom
        || limits.overscroll < 0
    ) {
        throw new Error("Camera limits are invalid.");
    }
}

function assertTransform(transform: SceneTransform): void {
    assertFinite(transform.scale, "Scene transform scale");
    if (transform.scale <= 0) {
        throw new Error("Scene transform scale must be positive.");
    }
    assertFinite(transform.translateX, "Scene transform translate X");
    assertFinite(transform.translateY, "Scene transform translate Y");
}

function assertFinite(value: number, label: string): void {
    if (!Number.isFinite(value)) {
        throw new Error(`${label} must be finite.`);
    }
}

function validCamera(camera: ContextCamera): boolean {
    return Number.isFinite(camera.zoom)
        && camera.zoom > 0
        && Number.isFinite(camera.panX)
        && Number.isFinite(camera.panY);
}

function validTransform(transform: SceneTransform): boolean {
    return Number.isFinite(transform.scale)
        && transform.scale > 0
        && Number.isFinite(transform.translateX)
        && Number.isFinite(transform.translateY);
}

function validViewport(viewport: Viewport): boolean {
    return Number.isFinite(viewport.width)
        && viewport.width > 0
        && Number.isFinite(viewport.height)
        && viewport.height > 0;
}

function validLimits(limits: CameraLimits): boolean {
    return Number.isFinite(limits.minZoom)
        && limits.minZoom > 0
        && Number.isFinite(limits.maxZoom)
        && limits.maxZoom >= limits.minZoom
        && Number.isFinite(limits.overscroll)
        && limits.overscroll >= 0;
}

function validBounds(bounds: SceneBounds): boolean {
    return Number.isFinite(bounds.minX)
        && Number.isFinite(bounds.maxX)
        && Number.isFinite(bounds.minY)
        && Number.isFinite(bounds.maxY)
        && bounds.minX <= bounds.maxX
        && bounds.minY <= bounds.maxY;
}
