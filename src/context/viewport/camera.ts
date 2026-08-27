import type { ContextMode, ScenePoint, SceneTransform, Viewport } from "../contract";
import { clampCameraToBounds, clampCameraToProbeBounds, FIT_PADDING } from "./bounds";
import type {
    CameraHomeFocus,
    CameraHomeView,
    CameraLimits,
    ContextCamera,
    ContextPinchSnapshot,
    ResolvedCameraHomeFocus,
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

/**
 * Places Home so the fixed centre probe sits on the requested anchor.
 *
 * The anchor is expressed in base space, which is the scene projected by the base transform without
 * the camera, so it stays valid across zoom changes. When no anchor is supplied Home falls back to
 * the geometric centre of the scene bounds, which is the historical behaviour. The result is always
 * clamped to the same bounds as any other camera, so an anchor can never escape the context.
 */
export function resetCamera(
    homeZoom: number,
    limits: CameraLimits,
    baseBounds: SceneBounds,
    viewport: Viewport,
    homeAnchor: ScenePoint | null = null
): ContextCamera {
    assertFinite(homeZoom, "Home zoom");
    assertLimits(limits);
    const anchor = homeAnchor !== null
        && Number.isFinite(homeAnchor.x)
        && Number.isFinite(homeAnchor.y)
        ? homeAnchor
        : {
            x: (baseBounds.minX + baseBounds.maxX) / 2,
            y: (baseBounds.minY + baseBounds.maxY) / 2
        };
    const zoom = Math.min(Math.max(homeZoom, limits.minZoom), limits.maxZoom);
    return clampCameraToBounds({
        zoom,
        panX: viewport.width / 2 - anchor.x * zoom,
        panY: viewport.height / 2 - anchor.y * zoom
    }, baseBounds, viewport, limits.overscroll);
}

export function resolveCameraHomeFocus(
    requested: CameraHomeFocus,
    mode: ContextMode
): ResolvedCameraHomeFocus {
    if (requested !== "automatic") {
        return requested;
    }
    // Only a built-in pack paints a complete backdrop while binding a subset of it, so only there
    // can the geometric centre land on a feature with no data, or on open ocean. Generated and
    // bound scenes derive their bounds from the bound Entities themselves, so their geometric
    // centre already sits inside the data and moving Home would only push features out of view.
    return mode === "builtInPack" ? "dataBearing" : "sceneCenter";
}

/**
 * Picks the deterministic base-space anchor Home should centre on.
 *
 * Candidates are the features that both carry an Entity binding and have loaded profile detail, so
 * the probe opens on a profile that actually renders. Among them the anchor is the candidate
 * closest to the candidate centroid, which keeps the opening view in the middle of the bound data
 * rather than at an arbitrary edge. Ties break on the provider-canonical key so the same scene
 * always resolves to the same anchor. When nothing qualifies the result is null and Home degrades
 * to the geometric scene centre.
 */
export function resolveHomeAnchor(
    candidates: readonly { readonly key: string; readonly center: ScenePoint }[],
    baseTransform: SceneTransform
): ScenePoint | null {
    const usable = candidates
        .filter((candidate) =>
            Number.isFinite(candidate.center.x) && Number.isFinite(candidate.center.y))
        .map((candidate) => ({
            key: candidate.key,
            point: projectPoint(candidate.center, baseTransform)
        }))
        .filter((candidate) =>
            Number.isFinite(candidate.point.x) && Number.isFinite(candidate.point.y));
    if (usable.length === 0) {
        return null;
    }
    if (usable.length === 1) {
        return usable[0].point;
    }
    const centroid = usable.reduce(
        (total, candidate) => ({
            x: total.x + candidate.point.x / usable.length,
            y: total.y + candidate.point.y / usable.length
        }),
        { x: 0, y: 0 }
    );
    let best = usable[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of usable) {
        const distance = (candidate.point.x - centroid.x) ** 2
            + (candidate.point.y - centroid.y) ** 2;
        if (distance < bestDistance || (distance === bestDistance && candidate.key < best.key)) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return best.point;
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
    viewport: Viewport,
    boundary: "scene" | "probe" = "scene"
): ContextCamera {
    assertCamera(camera);
    assertFinite(deltaX, "Camera pan delta X");
    assertFinite(deltaY, "Camera pan delta Y");
    assertLimits(limits);
    const next = {
        ...camera,
        panX: camera.panX + deltaX,
        panY: camera.panY + deltaY
    };
    return boundary === "probe"
        ? clampCameraToProbeBounds(next, baseBounds, viewport, limits.overscroll)
        : clampCameraToBounds(next, baseBounds, viewport, limits.overscroll);
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

export function anchorEquals(left: ScenePoint | null, right: ScenePoint | null): boolean {
    if (left === null || right === null) {
        return left === right;
    }
    return left.x === right.x && left.y === right.y;
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
