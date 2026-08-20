import { LIMITS } from "../model/contract";
import type {
    ContextFeature,
    ContextHit,
    ContextMapLayer,
    ContextRenderRequest,
    ContextRendererKind,
    ContextScene,
    ScenePoint,
    SceneTransform,
} from "../context/contract";
import type { ContextCamera } from "../context/viewport/contract";
import {
    decodeFeatureColor,
    encodeFeatureColor,
    hitTestBoundedCandidates,
    hitTestFeature,
    hitTestScene,
} from "../context/hitTest";
import {
    cameraEquals,
    cameraToBasePoint,
    composeSceneTransform,
    projectPoint
} from "../context/viewport/camera";

const SVG_NS = "http://www.w3.org/2000/svg";
const PICKING_BUCKET_SIZE = 32;

export interface ContextSurfaceElements {
    readonly root: HTMLElement;
    readonly canvas: HTMLCanvasElement;
    readonly svg: SVGSVGElement;
    readonly semantic: HTMLElement;
    readonly attribution: HTMLElement;
    readonly resetButton: HTMLButtonElement;
    readonly help: HTMLElement;
}

export interface ContextSurfaceStyle {
    readonly fill: string;
    readonly stroke: string;
    readonly selected: string;
    readonly background: string;
    readonly pointSize: number;
    readonly ocean: string;
    readonly land: string;
    readonly water: string;
    readonly waterOutline: string;
    readonly river: string;
    readonly graticule: string;
    readonly coastline: string;
    readonly admin: string;
    readonly mapLabel: string;
    readonly mapLabelHalo: string;
}

export interface RenderedContextSurface {
    readonly kind: ContextRendererKind;
    readonly hitTest: (x: number, y: number) => ContextHit | null;
    readonly setCamera: (camera: ContextCamera) => boolean;
    readonly getCamera: () => ContextCamera;
    readonly updateDynamic: (request: ContextRenderRequest) => void;
}

export interface ContextPerformanceMetrics {
    homeZoom: number;
    cameraZoom: number;
    panX: number;
    panY: number;
    providerBuilds: number;
    sceneBuilds: number;
    sceneIndexBuilds: number;
    sceneBuildDurationMs: number;
    svgGeometryBuilds: number;
    svgGeometryBuildDurationMs: number;
    canvasRasterBuilds: number;
    canvasRasterBuildDurationMs: number;
    canvasPickingBuilds: number;
    canvasPickingBuildDurationMs: number;
    canvasCameraDraws: number;
    canvasReferenceLineDraws: number;
    canvasInteractivePathDraws: number;
    readonly canvasReferenceScreenLineWidths: number[];
    readonly canvasReferenceStrokeColors: string[];
    readonly canvasReferenceLineRoles: string[];
    readonly canvasReferenceCompositeOrder: string[];
    cameraFrames: number;
    moveEnds: number;
    cameraFrameDurationMs: number;
    maxCameraFrameDurationMs: number;
    readonly cameraFrameDurationsMs: number[];
    probeResolutions: number;
    probeTransitions: number;
    probeDedupes: number;
    probeResolveDurationMs: number;
    maxProbeResolveDurationMs: number;
    readonly probeResolveDurationsMs: number[];
    profilePartialUpdates: number;
    profilePartialDurationMs: number;
    maxProfilePartialDurationMs: number;
    readonly profilePartialDurationsMs: number[];
    dynamicOverlayUpdates: number;
    referenceGeometryBuilds: number;
    labelLayoutUpdates: number;
    labelCandidatesEvaluated: number;
    maxVisibleLabels: number;
    hostSelectionRequests: number;
    hostSelectionResolved: number;
    hostSelectionRejected: number;
    hostSelectionStale: number;
    hostSelectionQueued: number;
    hostSelectionCoalesced: number;
    hostSelectionExternalInvalidations: number;
    hostSelectionInFlight: number;
    maxHostSelectionInFlight: number;
}

interface SurfaceCache {
    readonly key: string;
    readonly kind: ContextRendererKind;
    readonly scene: ContextScene;
    readonly viewport: ContextRenderRequest["viewport"];
    readonly baseTransform: SceneTransform;
    readonly style: ContextSurfaceStyle;
    readonly pointSize: number;
    readonly picking: PickingState | null;
    readonly metrics: ContextPerformanceMetrics;
    readonly canvasHitMetrics: CanvasHitMetrics | null;
    readonly canvasBase: HTMLCanvasElement | null;
    readonly canvasBaseOverscan: number;
    readonly canvasDisplayContext: CanvasRenderingContext2D | null;
    readonly canvasDisplayDpr: number;
    readonly canvasReferenceLines: readonly CanvasReferenceLine[] | null;
    readonly canvasInteractivePath: Path2D | null;
    readonly geometryGroup: SVGGElement | null;
    readonly outlineGroup: SVGGElement;
    readonly fixedGroup: SVGGElement;
    readonly labelGroup: SVGGElement;
    currentRequest: ContextRenderRequest;
    camera: ContextCamera;
    connectorLine: SVGLineElement | null;
    connectorFeatureCenter: ContextFeature["geometry"]["center"] | null;
    connectorTarget: ContextRenderRequest["connectorTarget"] | null;
}

const surfaceCaches = new WeakMap<HTMLElement, SurfaceCache>();

export function createContextPerformanceMetrics(): ContextPerformanceMetrics {
    return {
        homeZoom: 1,
        cameraZoom: 1,
        panX: 0,
        panY: 0,
        providerBuilds: 0,
        sceneBuilds: 0,
        sceneIndexBuilds: 0,
        sceneBuildDurationMs: 0,
        svgGeometryBuilds: 0,
        svgGeometryBuildDurationMs: 0,
        canvasRasterBuilds: 0,
        canvasRasterBuildDurationMs: 0,
        canvasPickingBuilds: 0,
        canvasPickingBuildDurationMs: 0,
        canvasCameraDraws: 0,
        canvasReferenceLineDraws: 0,
        canvasInteractivePathDraws: 0,
        canvasReferenceScreenLineWidths: [],
        canvasReferenceStrokeColors: [],
        canvasReferenceLineRoles: [],
        canvasReferenceCompositeOrder: [],
        cameraFrames: 0,
        moveEnds: 0,
        cameraFrameDurationMs: 0,
        maxCameraFrameDurationMs: 0,
        cameraFrameDurationsMs: [],
        probeResolutions: 0,
        probeTransitions: 0,
        probeDedupes: 0,
        probeResolveDurationMs: 0,
        maxProbeResolveDurationMs: 0,
        probeResolveDurationsMs: [],
        profilePartialUpdates: 0,
        profilePartialDurationMs: 0,
        maxProfilePartialDurationMs: 0,
        profilePartialDurationsMs: [],
        dynamicOverlayUpdates: 0,
        referenceGeometryBuilds: 0,
        labelLayoutUpdates: 0,
        labelCandidatesEvaluated: 0,
        maxVisibleLabels: 0,
        hostSelectionRequests: 0,
        hostSelectionResolved: 0,
        hostSelectionRejected: 0,
        hostSelectionStale: 0,
        hostSelectionQueued: 0,
        hostSelectionCoalesced: 0,
        hostSelectionExternalInvalidations: 0,
        hostSelectionInFlight: 0,
        maxHostSelectionInFlight: 0
    };
}

export function recordContextSceneBuild(
    metrics: ContextPerformanceMetrics,
    durationMs: number
): void {
    assertDuration(durationMs);
    metrics.providerBuilds++;
    metrics.sceneBuilds++;
    metrics.sceneIndexBuilds++;
    metrics.sceneBuildDurationMs += durationMs;
}

export function createContextSurface(parent: HTMLElement): ContextSurfaceElements {
    const root = document.createElement("div");
    root.className = "profile-lens-context";
    root.setAttribute("role", "listbox");
    root.setAttribute("aria-multiselectable", "true");
    root.setAttribute("tabindex", "0");
    const canvas = document.createElement("canvas");
    canvas.className = "profile-lens-context-canvas";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("profile-lens-context-svg");
    const semantic = document.createElement("div");
    semantic.className = "profile-lens-context-semantic";
    const attribution = document.createElement("div");
    attribution.className = "profile-lens-context-attribution";
    const resetButton = document.createElement("button");
    resetButton.className = "profile-lens-context-reset";
    resetButton.type = "button";
    resetButton.tabIndex = -1;
    const help = document.createElement("div");
    help.className = "profile-lens-context-help";
    root.append(canvas, svg, semantic, attribution, help, resetButton);
    parent.insertBefore(root, parent.firstChild);
    return { root, canvas, svg, semantic, attribution, resetButton, help };
}

export function renderContextSurface(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest,
    kind: ContextRendererKind,
    style: ContextSurfaceStyle,
    devicePixelRatio: number,
    performanceMetrics: ContextPerformanceMetrics
): RenderedContextSurface {
    elements.root.removeAttribute("hidden");
    elements.root.setAttribute("aria-setsize", String(request.scene.backdrop.features.length));
    renderAttribution(elements, request);
    renderSemanticOptions(elements, request);
    renderNavigationChrome(elements, request);
    const key = surfaceBuildKey(request, kind, style, devicePixelRatio);
    let cache = surfaceCaches.get(elements.root);
    if (!cache || cache.key !== key) {
        setContextPerformanceMetrics(elements.root, null);
        setCanvasHitMetrics(elements.root, null);
        cache = buildSurface(
            elements,
            request,
            kind,
            style,
            devicePixelRatio,
            performanceMetrics,
            key
        );
        surfaceCaches.set(elements.root, cache);
    }
    cache.camera = request.camera;
    cache.currentRequest = request;
    performanceMetrics.cameraZoom = request.camera.zoom;
    performanceMetrics.panX = request.camera.panX;
    performanceMetrics.panY = request.camera.panY;
    renderDynamicOverlay(cache, request);
    applyCamera(elements, cache);
    setContextPerformanceMetrics(elements.root, performanceMetrics);
    return {
        kind,
        hitTest: (x, y) => hitTestCachedSurface(elements.root, x, y),
        setCamera: (camera) => setSurfaceCamera(elements, camera),
        getCamera: () => requireSurfaceCache(elements.root).camera,
        updateDynamic: (dynamicRequest) => updateSurfaceDynamic(elements, dynamicRequest)
    };
}

function updateSurfaceDynamic(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest
): void {
    const cache = requireSurfaceCache(elements.root);
    cache.currentRequest = request;
    renderSemanticOptions(elements, request);
    renderDynamicOverlay(cache, request);
    applyDynamicCamera(cache);
}

export function hideContextSurface(elements: ContextSurfaceElements): void {
    elements.root.setAttribute("hidden", "hidden");
    clearCanvas(elements.canvas);
    clearSvg(elements.svg);
    clearElement(elements.semantic);
    clearElement(elements.attribution);
    elements.resetButton.setAttribute("hidden", "hidden");
    elements.help.setAttribute("hidden", "hidden");
    surfaceCaches.delete(elements.root);
    setCanvasHitMetrics(elements.root, null);
    setContextPerformanceMetrics(elements.root, null);
}

function renderAttribution(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest
): void {
    const metadata = request.scene.metadata;
    const descriptions: string[] = [];
    if (!metadata) {
        elements.attribution.setAttribute("hidden", "hidden");
        elements.attribution.textContent = "";
    } else {
        const text = `${metadata.displayName}; ${metadata.vintage}; ${metadata.attribution}`;
        elements.attribution.textContent = text;
        elements.attribution.removeAttribute("hidden");
        descriptions.push(text);
    }
    if (request.navigation.enabled) {
        if (request.navigation.showProbe) {
            descriptions.push(request.navigation.probeDescription);
        }
        descriptions.push(request.navigation.gestureHelp);
    }
    if (descriptions.length > 0) {
        elements.root.setAttribute("aria-description", descriptions.join(". "));
    } else {
        elements.root.removeAttribute("aria-description");
    }
}

function surfaceBuildKey(
    request: ContextRenderRequest,
    kind: ContextRendererKind,
    style: ContextSurfaceStyle,
    devicePixelRatio: number
): string {
    const allocation = kind === "canvas"
        ? canvasAllocation(request.viewport.width, request.viewport.height, devicePixelRatio)
        : null;
    const overscan = kind === "canvas" ? canvasOverscan(request, style) : 0;
    const baseAllocation = kind === "canvas"
        ? canvasAllocation(
            request.viewport.width + overscan * 2,
            request.viewport.height + overscan * 2,
            devicePixelRatio
        )
        : null;
    return [
        request.sceneIdentity,
        request.paintIdentity,
        kind,
        request.viewport.width,
        request.viewport.height,
        request.baseTransform.scale,
        request.baseTransform.translateX,
        request.baseTransform.translateY,
        request.baseTransform.invertY,
        allocation?.width ?? 0,
        allocation?.height ?? 0,
        allocation?.dpr ?? 0,
        overscan,
        baseAllocation?.width ?? 0,
        baseAllocation?.height ?? 0,
        baseAllocation?.dpr ?? 0,
        request.pointSize ?? style.pointSize,
        style.fill,
        style.stroke,
        style.selected,
        style.background
        , style.ocean
        , style.land
        , style.water
        , style.waterOutline
        , style.graticule
        , style.coastline
        , style.admin
        , style.mapLabel
        , style.mapLabelHalo
        , request.cartography.detail
        , request.cartography.showPhysicalLayers
        , request.cartography.showLabels
        , request.cartography.showGraticule
        , request.cartography.labelDensity
    ].join("|");
}

function buildSurface(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest,
    kind: ContextRendererKind,
    style: ContextSurfaceStyle,
    devicePixelRatio: number,
    metrics: ContextPerformanceMetrics,
    key: string
): SurfaceCache {
    const svg = elements.svg;
    clearSvg(svg);
    svg.setAttribute("width", String(request.viewport.width));
    svg.setAttribute("height", String(request.viewport.height));
    svg.setAttribute("viewBox", `0 0 ${request.viewport.width} ${request.viewport.height}`);
    elements.root.style.backgroundColor = request.scene.cartography
        && request.cartography.detail !== "none"
        ? style.ocean
        : style.background;
    const pointSize = request.pointSize ?? style.pointSize;
    let geometryGroup: SVGGElement | null = null;
    let picking: PickingState | null = null;
    let canvasHitMetrics: CanvasHitMetrics | null = null;
    let canvasBase: HTMLCanvasElement | null = null;
    let canvasBaseOverscan = 0;
    let canvasDisplayContext: CanvasRenderingContext2D | null = null;
    let canvasDisplayDpr = 1;
    let canvasReferenceLines: readonly CanvasReferenceLine[] | null = null;
    let canvasInteractivePath: Path2D | null = null;

    if (kind === "svg") {
        const started = performance.now();
        geometryGroup = document.createElementNS(SVG_NS, "g");
        geometryGroup.classList.add("profile-lens-context-camera-layer");
        appendSvgReferenceLayers(
            geometryGroup,
            request,
            style,
            new Set(["sphere", "land", "water", "river", "graticule"])
        );
        for (const feature of request.scene.backdrop.features) {
            const node = createSvgFeature(
                feature,
                request.baseTransform,
                pointSize,
                style
            );
            node.setAttribute("data-context-key", feature.key);
            node.setAttribute("aria-hidden", "true");
            if (
                !request.showNoDataBackdrop
                && !request.scene.entities.byFeatureKey.has(feature.key)
            ) {
                node.setAttribute("visibility", "hidden");
            }
            geometryGroup.appendChild(node);
        }
        appendSvgReferenceLayers(
            geometryGroup,
            request,
            style,
            new Set(["coastline", "admin0", "admin1", "insetFrame"])
        );
        if (request.scene.cartography && request.cartography.detail !== "none") {
            metrics.referenceGeometryBuilds++;
        }
        metrics.svgGeometryBuilds++;
        metrics.svgGeometryBuildDurationMs += measuredDuration(started);
        svg.appendChild(geometryGroup);
        clearCanvas(elements.canvas);
        elements.canvas.style.transform = "";
        setCanvasHitMetrics(elements.root, null);
    } else {
        const result = renderCanvas(elements, request, style, devicePixelRatio);
        picking = result.picking;
        canvasBase = result.baseCanvas;
        canvasBaseOverscan = result.overscan;
        canvasDisplayContext = result.displayContext;
        canvasDisplayDpr = result.displayDpr;
        canvasReferenceLines = result.referenceLines;
        canvasInteractivePath = result.interactivePath;
        metrics.canvasRasterBuilds++;
        metrics.canvasRasterBuildDurationMs += result.rasterDurationMs;
        metrics.canvasPickingBuilds++;
        metrics.canvasPickingBuildDurationMs += result.pickingDurationMs;
        if (request.scene.cartography && request.cartography.detail !== "none") {
            metrics.referenceGeometryBuilds++;
        }
        canvasHitMetrics = createCanvasHitMetrics(
            request.scene,
            picking,
            elements.canvas,
            result.baseCanvas
        );
        setCanvasHitMetrics(elements.root, canvasHitMetrics);
    }

    const outlineGroup = document.createElementNS(SVG_NS, "g");
    const labelGroup = document.createElementNS(SVG_NS, "g");
    labelGroup.classList.add("profile-lens-context-label-layer");
    svg.appendChild(labelGroup);
    outlineGroup.classList.add("profile-lens-context-outline-layer");
    svg.appendChild(outlineGroup);
    const fixedGroup = document.createElementNS(SVG_NS, "g");
    fixedGroup.classList.add("profile-lens-context-fixed-layer");
    svg.appendChild(fixedGroup);

    return {
        key,
        kind,
        scene: request.scene,
        viewport: request.viewport,
        baseTransform: request.baseTransform,
        style,
        pointSize,
        picking,
        metrics,
        canvasHitMetrics,
        canvasBase,
        canvasBaseOverscan,
        canvasDisplayContext,
        canvasDisplayDpr,
        canvasReferenceLines,
        canvasInteractivePath,
        geometryGroup,
        outlineGroup,
        fixedGroup,
        labelGroup,
        currentRequest: request,
        camera: request.camera,
        connectorLine: null,
        connectorFeatureCenter: null,
        connectorTarget: null
    };
}

function createCanvasHitMetrics(
    scene: ContextScene,
    picking: PickingState,
    displayCanvas: HTMLCanvasElement,
    baseCanvas: HTMLCanvasElement
): CanvasHitMetrics {
    return {
        sceneFeatures: scene.backdrop.features.length,
        pickingReads: 0,
        candidateValidations: 0,
        targetMapLookups: 0,
        targetMapMisses: 0,
        resolvedHits: 0,
        pickedCandidatesDecoded: 0,
        normalBucketChecks: 0,
        normalCandidateValidationAttempts: 0,
        normalPickingSuccesses: 0,
        fallbackQueries: 0,
        fallbackCandidateReferencesRead: 0,
        fallbackCandidateValidations: 0,
        maxFallbackCandidatesExamined: 0,
        spatialBucketEntries: picking.spatialBucketEntries,
        maxBucketOccupancy: picking.maxBucketOccupancy,
        spatialReferenceBudget: LIMITS.maxPickingSpatialReferences,
        bucketSize: picking.bucketSize,
        pickingScaleX: picking.scaleX,
        pickingScaleY: picking.scaleY,
        displayBackingWidth: displayCanvas.width,
        displayBackingHeight: displayCanvas.height,
        baseRasterBackingWidth: baseCanvas.width,
        baseRasterBackingHeight: baseCanvas.height,
        pickingBackingWidth: picking.width,
        pickingBackingHeight: picking.height,
        totalBackingPixels: displayCanvas.width * displayCanvas.height
            + baseCanvas.width * baseCanvas.height
            + picking.width * picking.height
    };
}

function renderDynamicOverlay(cache: SurfaceCache, request: ContextRenderRequest): void {
    clearSvg(cache.outlineGroup);
    clearSvg(cache.fixedGroup);
    cache.connectorLine = null;
    cache.connectorFeatureCenter = null;
    cache.connectorTarget = request.connectorTarget ?? null;
    renderMapLabels(cache, request);
    const focused = request.focusedFeatureKey === null
        ? null
        : request.scene.backdrop.featureByKey.get(request.focusedFeatureKey) ?? null;
    if (focused && request.connectorTarget) {
        const line = document.createElementNS(SVG_NS, "line");
        line.classList.add("profile-lens-context-connector");
        line.setAttribute("x2", String(request.connectorTarget.x));
        line.setAttribute("y2", String(request.connectorTarget.y));
        line.setAttribute("stroke", cache.style.selected);
        line.setAttribute("stroke-width", "2");
        line.setAttribute("stroke-dasharray", "4 3");
        line.setAttribute("aria-hidden", "true");
        cache.fixedGroup.appendChild(line);
        cache.connectorLine = line;
        cache.connectorFeatureCenter = focused.geometry.center;
    }
    const overlayKeys = new Set(request.selectedFeatureKeys);
    if (request.focusedFeatureKey !== null) {
        overlayKeys.add(request.focusedFeatureKey);
    }
    for (const featureKey of overlayKeys) {
        const feature = request.scene.backdrop.featureByKey.get(featureKey);
        if (!feature) {
            continue;
        }
        const overlay = createSvgFeature(
            feature,
            request.baseTransform,
            cache.pointSize,
            cache.style
        );
        overlay.classList.add("profile-lens-context-outline");
        overlay.setAttribute("fill", "none");
        overlay.setAttribute("stroke", cache.style.selected);
        overlay.setAttribute("stroke-width", "3");
        overlay.setAttribute("vector-effect", "non-scaling-stroke");
        overlay.setAttribute("pointer-events", "none");
        overlay.setAttribute("aria-hidden", "true");
        cache.outlineGroup.appendChild(overlay);
    }
    if (request.navigation.enabled && request.navigation.showProbe) {
        appendProbe(cache.fixedGroup, request.viewport, cache.style);
    }
}

function appendProbe(
    parent: SVGGElement,
    viewport: ContextRenderRequest["viewport"],
    style: ContextSurfaceStyle
): void {
    const x = viewport.width / 2;
    const y = viewport.height / 2;
    const group = document.createElementNS(SVG_NS, "g");
    group.classList.add("profile-lens-context-probe");
    group.setAttribute("aria-hidden", "true");
    const halo = document.createElementNS(SVG_NS, "circle");
    halo.setAttribute("cx", String(x));
    halo.setAttribute("cy", String(y));
    halo.setAttribute("r", "7");
    halo.setAttribute("fill", style.background);
    halo.setAttribute("stroke", style.background);
    halo.setAttribute("stroke-width", "3");
    const ring = document.createElementNS(SVG_NS, "circle");
    ring.setAttribute("cx", String(x));
    ring.setAttribute("cy", String(y));
    ring.setAttribute("r", "5");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", style.selected);
    ring.setAttribute("stroke-width", "2");
    const horizontal = document.createElementNS(SVG_NS, "line");
    horizontal.setAttribute("x1", String(x - 10));
    horizontal.setAttribute("x2", String(x + 10));
    horizontal.setAttribute("y1", String(y));
    horizontal.setAttribute("y2", String(y));
    horizontal.setAttribute("stroke", style.selected);
    horizontal.setAttribute("stroke-width", "2");
    const vertical = document.createElementNS(SVG_NS, "line");
    vertical.setAttribute("x1", String(x));
    vertical.setAttribute("x2", String(x));
    vertical.setAttribute("y1", String(y - 10));
    vertical.setAttribute("y2", String(y + 10));
    vertical.setAttribute("stroke", style.selected);
    vertical.setAttribute("stroke-width", "2");
    group.append(halo, ring, horizontal, vertical);
    parent.appendChild(group);
}

function renderNavigationChrome(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest
): void {
    const active = request.navigation.enabled && request.interactive;
    elements.root.classList.toggle("profile-lens-context-navigation", request.navigation.enabled);
    elements.root.classList.toggle("profile-lens-context-navigation-active", active);
    elements.resetButton.textContent = request.navigation.resetLabel;
    elements.resetButton.setAttribute("aria-label", request.navigation.resetLabel);
    elements.resetButton.disabled = !active;
    elements.resetButton.tabIndex = -1;
    if (active && request.navigation.showResetControl) {
        elements.resetButton.removeAttribute("hidden");
    } else {
        elements.resetButton.setAttribute("hidden", "hidden");
    }
    elements.help.textContent = request.navigation.gestureHelp;
    const helpFits = request.viewport.width >= 120 && request.viewport.height >= 120;
    if (request.navigation.enabled && request.navigation.showGestureHelp && helpFits) {
        elements.help.removeAttribute("hidden");
    } else {
        elements.help.setAttribute("hidden", "hidden");
    }
}

function applyCamera(elements: ContextSurfaceElements, cache: SurfaceCache): void {
    const matrix = cameraMatrix(cache.camera);
    if (cache.kind === "canvas") {
        drawCanvasCamera(elements.canvas, cache);
    }
    cache.geometryGroup?.setAttribute("transform", matrix);
    applyDynamicCamera(cache);
    renderMapLabels(cache, cache.currentRequest);
}

function applyDynamicCamera(cache: SurfaceCache): void {
    const matrix = cameraMatrix(cache.camera);
    cache.outlineGroup.setAttribute("transform", matrix);
    if (cache.connectorLine && cache.connectorFeatureCenter && cache.connectorTarget) {
        const center = projectPoint(
            cache.connectorFeatureCenter,
            composeSceneTransform(cache.baseTransform, cache.camera)
        );
        cache.connectorLine.setAttribute("x1", String(center.x));
        cache.connectorLine.setAttribute("y1", String(center.y));
    }
}

function setSurfaceCamera(elements: ContextSurfaceElements, camera: ContextCamera): boolean {
    const cache = requireSurfaceCache(elements.root);
    if (cameraEquals(cache.camera, camera)) {
        return false;
    }
    const started = performance.now();
    cache.camera = camera;
    cache.metrics.cameraZoom = camera.zoom;
    cache.metrics.panX = camera.panX;
    cache.metrics.panY = camera.panY;
    applyCamera(elements, cache);
    const duration = measuredDuration(started);
    cache.metrics.cameraFrames++;
    cache.metrics.cameraFrameDurationMs += duration;
    cache.metrics.maxCameraFrameDurationMs = Math.max(
        cache.metrics.maxCameraFrameDurationMs,
        duration
    );
    cache.metrics.cameraFrameDurationsMs.push(duration);
    if (cache.metrics.cameraFrameDurationsMs.length > 128) {
        cache.metrics.cameraFrameDurationsMs.shift();
    }
    return true;
}

function hitTestCachedSurface(root: HTMLElement, x: number, y: number): ContextHit | null {
    const cache = requireSurfaceCache(root);
    const basePoint = cameraToBasePoint({ x, y }, cache.camera);
    if (cache.kind === "svg") {
        return hitTestScene(
            cache.scene,
            cache.baseTransform,
            basePoint.x,
            basePoint.y,
            cache.pointSize
        );
    }
    const picking = cache.picking;
    const metrics = cache.canvasHitMetrics;
    if (!picking || !metrics) {
        throw new Error("Canvas context surface is missing its picking state.");
    }
    metrics.pickingReads++;
    const picked = hitPicking(picking, basePoint.x, basePoint.y);
    if (picked) {
        metrics.pickedCandidatesDecoded++;
    }
    metrics.normalBucketChecks++;
    const bucketKey = pickingBucketKey(picking, basePoint.x, basePoint.y);
    const topmostBucketCandidate = picking.topmostByBucket.get(bucketKey) ?? null;
    if (picked && picked === topmostBucketCandidate) {
        metrics.normalCandidateValidationAttempts++;
        metrics.candidateValidations++;
        if (hitTestFeature(
            picked,
            cache.baseTransform,
            basePoint.x,
            basePoint.y,
            cache.pointSize
        )) {
            metrics.normalPickingSuccesses++;
            metrics.resolvedHits++;
            return { featureIndex: picked.index, featureKey: picked.key };
        }
    }
    metrics.fallbackQueries++;
    const localized = pickingCandidatesAt(picking, bucketKey);
    metrics.fallbackCandidateReferencesRead += localized.referencesRead;
    const result = hitTestBoundedCandidates(
        picked,
        localized.candidates,
        cache.baseTransform,
        basePoint.x,
        basePoint.y,
        cache.pointSize
    );
    metrics.candidateValidations += result.candidateValidations;
    metrics.fallbackCandidateValidations += result.localizedCandidateValidations;
    metrics.maxFallbackCandidatesExamined = Math.max(
        metrics.maxFallbackCandidatesExamined,
        result.localizedCandidatesExamined
    );
    if (result.hit) {
        metrics.resolvedHits++;
    }
    return result.hit;
}

function requireSurfaceCache(root: HTMLElement): SurfaceCache {
    const cache = surfaceCaches.get(root);
    if (!cache) {
        throw new Error("Context surface has not been rendered.");
    }
    return cache;
}

function cameraMatrix(camera: ContextCamera): string {
    return `matrix(${camera.zoom},0,0,${camera.zoom},${camera.panX},${camera.panY})`;
}

function measuredDuration(started: number): number {
    const duration = performance.now() - started;
    assertDuration(duration);
    return duration;
}

function assertDuration(duration: number): void {
    if (!Number.isFinite(duration) || duration < 0) {
        throw new Error("Context performance duration must be finite and non-negative.");
    }
}

function renderSemanticOptions(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest
): void {
    clearElement(elements.semantic);
    const features = request.scene.backdrop.features;
    const focusedIndex = request.focusedFeatureKey === null
        ? 0
        : request.scene.backdrop.featureByKey.get(request.focusedFeatureKey)?.index ?? 0;
    const maxOptions = 100;
    const start = Math.max(
        Math.min(focusedIndex - Math.floor(maxOptions / 2), features.length - maxOptions),
        0
    );
    const retained = features.slice(start, start + maxOptions);
    for (const feature of retained) {
        const option = document.createElement("div");
        option.id = `context:${feature.key}`;
        option.setAttribute("role", "option");
        option.setAttribute(
            "aria-label",
            request.featureDescriptions?.get(feature.key) ?? feature.description
        );
        option.setAttribute(
            "aria-selected",
            request.selectedFeatureKeys.has(feature.key)
                || feature.key === request.focusedFeatureKey ? "true" : "false"
        );
        option.setAttribute("aria-posinset", String(feature.index + 1));
        option.setAttribute("aria-setsize", String(features.length));
        elements.semantic.appendChild(option);
    }
    const focused = request.focusedFeatureKey === null
        ? undefined
        : retained.find((feature) => feature.key === request.focusedFeatureKey);
    if (focused) {
        elements.root.setAttribute("aria-activedescendant", `context:${focused.key}`);
    } else {
        elements.root.removeAttribute("aria-activedescendant");
    }
}

interface PickingState {
    readonly context: CanvasRenderingContext2D;
    readonly width: number;
    readonly height: number;
    readonly featuresByIndex: ReadonlyMap<number, ContextFeature>;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly bucketSize: number;
    readonly buckets: ReadonlyMap<string, readonly ContextFeature[]>;
    readonly topmostByBucket: ReadonlyMap<string, ContextFeature>;
    readonly spatialBucketEntries: number;
    readonly maxBucketOccupancy: number;
}

function createSvgFeature(
    feature: ContextFeature,
    transform: SceneTransform,
    pointSize: number,
    style: ContextSurfaceStyle
): SVGElement {
    if (feature.geometry.points) {
        const group = document.createElementNS(SVG_NS, "g");
        for (const raw of feature.geometry.points) {
            const point = projectPoint(raw, transform);
            const circle = document.createElementNS(SVG_NS, "circle");
            circle.setAttribute("cx", String(point.x));
            circle.setAttribute("cy", String(point.y));
            circle.setAttribute("r", String(pointSize));
            group.appendChild(circle);
        }
        applySvgStyle(group, style);
        return group;
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData(feature, transform));
    path.setAttribute("fill-rule", "evenodd");
    applySvgStyle(path, style);
    return path;
}

function applySvgStyle(
    element: SVGElement,
    style: ContextSurfaceStyle
): void {
    element.setAttribute("fill", style.fill);
    element.setAttribute("stroke", style.stroke);
    element.setAttribute("stroke-width", "1");
}

function referenceLayerVisible(
    layer: ContextMapLayer,
    request: ContextRenderRequest
): boolean {
    if (request.cartography.detail === "none") return false;
    if (!request.cartography.showPhysicalLayers && (
        layer.role === "land"
        || layer.role === "water"
        || layer.role === "river"
    )) return false;
    if (!request.cartography.showGraticule && layer.role === "graticule") return false;
    if (
        request.cartography.detail === "standard"
        && (layer.role === "water" || layer.role === "river")
    ) return false;
    return true;
}

function referenceStyle(
    layer: ContextMapLayer,
    style: ContextSurfaceStyle
): { readonly fill: string | null; readonly stroke: string | null; readonly lineWidth: number } {
    switch (layer.role) {
        case "sphere":
            return { fill: style.ocean, stroke: null, lineWidth: 0 };
        case "land":
            return { fill: style.land, stroke: null, lineWidth: 0 };
        case "water":
            return { fill: style.water, stroke: style.waterOutline, lineWidth: 0.35 };
        case "river":
            return { fill: null, stroke: style.river, lineWidth: 0.45 };
        case "graticule":
            return { fill: null, stroke: style.graticule, lineWidth: 0.45 };
        case "coastline":
            return { fill: null, stroke: style.coastline, lineWidth: 0.9 };
        default:
            return { fill: null, stroke: style.admin, lineWidth: 0.6 };
    }
}

function appendSvgReferenceLayers(
    parent: SVGGElement,
    request: ContextRenderRequest,
    style: ContextSurfaceStyle,
    roles: ReadonlySet<ContextMapLayer["role"]>
): void {
    for (const layer of request.scene.cartography?.layers ?? []) {
        if (!roles.has(layer.role) || !referenceLayerVisible(layer, request)) continue;
        const layerStyle = referenceStyle(layer, style);
        const path = document.createElementNS(SVG_NS, "path");
        path.classList.add("profile-lens-context-reference");
        path.setAttribute("data-reference-role", layer.role);
        path.setAttribute("d", referencePathData(layer, request.baseTransform));
        path.setAttribute("fill-rule", "evenodd");
        path.setAttribute("fill", layerStyle.fill ?? "none");
        path.setAttribute("stroke", layerStyle.stroke ?? "none");
        path.setAttribute("stroke-width", String(layerStyle.lineWidth));
        path.setAttribute("vector-effect", "non-scaling-stroke");
        path.setAttribute("pointer-events", "none");
        path.setAttribute("aria-hidden", "true");
        parent.appendChild(path);
    }
}

function referencePathData(layer: ContextMapLayer, transform: SceneTransform): string {
    const commands: string[] = [];
    for (const polygon of layer.polygons ?? []) {
        for (const ring of polygon) {
            appendLineCommands(commands, ring, transform, true);
        }
    }
    for (const line of layer.lines ?? []) {
        appendLineCommands(commands, line, transform, false);
    }
    return commands.join(" ");
}

function appendLineCommands(
    commands: string[],
    points: readonly ScenePoint[],
    transform: SceneTransform,
    closed: boolean
): void {
    points.forEach((raw, index) => {
        const point = projectPoint(raw, transform);
        commands.push(`${index === 0 ? "M" : "L"}${point.x},${point.y}`);
    });
    if (closed) commands.push("Z");
}

function renderMapLabels(cache: SurfaceCache, request: ContextRenderRequest): void {
    clearSvg(cache.labelGroup);
    if (
        !request.scene.cartography
        || request.cartography.detail === "none"
        || !request.cartography.showLabels
    ) return;
    const caps = { sparse: 16, balanced: 28, detailed: 40 } as const;
    const cap = caps[request.cartography.labelDensity];
    const transform = composeSceneTransform(cache.baseTransform, cache.camera);
    const selected = request.selectedFeatureKeys;
    const labels = [...request.scene.cartography.labels].sort((left, right) => {
        const leftFocus = left.key === request.focusedFeatureKey ? 0 : selected.has(left.key) ? 1 : 2;
        const rightFocus = right.key === request.focusedFeatureKey ? 0 : selected.has(right.key) ? 1 : 2;
        return leftFocus - rightFocus
            || left.rank - right.rank
            || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    });
    const occupied: { x1: number; y1: number; x2: number; y2: number }[] = [];
    let visible = 0;
    let evaluated = 0;
    for (const label of labels) {
        const forced = label.key === request.focusedFeatureKey;
        if (
            !forced
            && (
                cache.camera.zoom < label.minZoom
                || (label.maxZoom !== undefined && cache.camera.zoom > label.maxZoom)
            )
        ) continue;
        evaluated++;
        const point = projectPoint(label.anchor, transform);
        if (
            point.x < 0
            || point.y < 0
            || point.x > cache.viewport.width
            || point.y > cache.viewport.height
        ) continue;
        const width = Math.max(20, label.text.length * 6.2 + 6);
        if (width > cache.viewport.width - 4) continue;
        const labelX = Math.min(
            Math.max(point.x, width / 2 + 2),
            cache.viewport.width - width / 2 - 2
        );
        const labelY = Math.min(Math.max(point.y, 10), cache.viewport.height - 9);
        const box = {
            x1: labelX - width / 2,
            y1: labelY - 8,
            x2: labelX + width / 2,
            y2: labelY + 7
        };
        if (!forced && occupied.some((other) =>
            box.x1 < other.x2
            && box.x2 > other.x1
            && box.y1 < other.y2
            && box.y2 > other.y1
        )) continue;
        const text = document.createElementNS(SVG_NS, "text");
        text.classList.add("profile-lens-context-map-label");
        text.setAttribute("data-label-key", label.key);
        text.setAttribute("x", String(labelX));
        text.setAttribute("y", String(labelY));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.setAttribute("font-size", "11");
        text.setAttribute("font-weight", forced ? "600" : "400");
        text.setAttribute("fill", cache.style.mapLabel);
        text.setAttribute("stroke", cache.style.mapLabelHalo);
        text.setAttribute("stroke-width", "3");
        text.setAttribute("stroke-linejoin", "round");
        text.setAttribute("paint-order", "stroke fill");
        text.setAttribute("pointer-events", "none");
        text.setAttribute("aria-hidden", "true");
        text.textContent = label.text;
        cache.labelGroup.appendChild(text);
        occupied.push(box);
        visible++;
        if (visible >= cap) break;
    }
    cache.metrics.labelLayoutUpdates++;
    cache.metrics.labelCandidatesEvaluated += Math.min(evaluated, labels.length);
    cache.metrics.maxVisibleLabels = Math.max(cache.metrics.maxVisibleLabels, visible);
}

interface CanvasBuildResult {
    readonly picking: PickingState;
    readonly baseCanvas: HTMLCanvasElement;
    readonly referenceLines: readonly CanvasReferenceLine[];
    readonly interactivePath: Path2D | null;
    readonly overscan: number;
    readonly displayContext: CanvasRenderingContext2D;
    readonly displayDpr: number;
    readonly rasterDurationMs: number;
    readonly pickingDurationMs: number;
}

interface CanvasReferenceLine {
    readonly role: ContextMapLayer["role"];
    readonly path: Path2D;
    readonly stroke: string;
    readonly lineWidth: number;
    readonly placement: "underlay" | "overlay";
}

function canvasOverscan(
    request: ContextRenderRequest,
    style: ContextSurfaceStyle
): number {
    return Math.ceil(Math.max(request.pointSize ?? style.pointSize, style.pointSize) + 2);
}

function drawCanvasCamera(
    canvas: HTMLCanvasElement,
    cache: SurfaceCache
): void {
    const context = cache.canvasDisplayContext;
    const base = cache.canvasBase;
    if (!context || !base) {
        throw new Error("Canvas camera frame requires a stable base raster.");
    }
    const { width, height } = cache.viewport;
    const overscan = cache.canvasBaseOverscan;
    context.setTransform(cache.canvasDisplayDpr, 0, 0, cache.canvasDisplayDpr, 0, 0);
    context.clearRect(0, 0, width, height);
    if (cache.currentRequest.scene.cartography && cache.currentRequest.cartography.detail !== "none") {
        context.fillStyle = cache.style.ocean;
        context.fillRect(0, 0, width, height);
    }
    context.save();
    context.translate(cache.camera.panX, cache.camera.panY);
    context.scale(cache.camera.zoom, cache.camera.zoom);
    context.drawImage(
        base,
        0,
        0,
        base.width,
        base.height,
        -overscan,
        -overscan,
        width + overscan * 2,
        height + overscan * 2
    );
    const referenceLines = cache.canvasReferenceLines ?? [];
    if (referenceLines.length > 0) {
        const screenWidths = cache.metrics.canvasReferenceScreenLineWidths;
        const strokeColors = cache.metrics.canvasReferenceStrokeColors;
        const lineRoles = cache.metrics.canvasReferenceLineRoles;
        const compositeOrder = cache.metrics.canvasReferenceCompositeOrder;
        screenWidths.splice(0, screenWidths.length);
        strokeColors.splice(0, strokeColors.length);
        lineRoles.splice(0, lineRoles.length);
        compositeOrder.splice(0, compositeOrder.length);
        context.lineJoin = "round";
        context.lineCap = "round";
        for (const line of referenceLines.filter((entry) => entry.placement === "underlay")) {
            context.strokeStyle = line.stroke;
            context.lineWidth = line.lineWidth / cache.camera.zoom;
            context.stroke(line.path);
            screenWidths.push(line.lineWidth);
            strokeColors.push(line.stroke);
            lineRoles.push(line.role);
            compositeOrder.push(line.role);
        }
    }
    if (cache.canvasInteractivePath) {
        context.fillStyle = cache.style.fill;
        context.fill(cache.canvasInteractivePath, "evenodd");
        context.strokeStyle = cache.style.stroke;
        context.lineWidth = 1;
        context.stroke(cache.canvasInteractivePath);
        cache.metrics.canvasInteractivePathDraws++;
        cache.metrics.canvasReferenceCompositeOrder.push("interactive");
    }
    for (const line of referenceLines.filter((entry) => entry.placement === "overlay")) {
        context.strokeStyle = line.stroke;
        context.lineWidth = line.lineWidth / cache.camera.zoom;
        context.stroke(line.path);
        cache.metrics.canvasReferenceScreenLineWidths.push(line.lineWidth);
        cache.metrics.canvasReferenceStrokeColors.push(line.stroke);
        cache.metrics.canvasReferenceLineRoles.push(line.role);
        cache.metrics.canvasReferenceCompositeOrder.push(line.role);
    }
    if (referenceLines.length > 0) cache.metrics.canvasReferenceLineDraws++;
    context.restore();
    canvas.style.transform = "";
    cache.metrics.canvasCameraDraws++;
}

function renderCanvas(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest,
    style: ContextSurfaceStyle,
    requestedDpr: number
): CanvasBuildResult {
    const rasterStarted = performance.now();
    const canvas = elements.canvas;
    const displayAllocation = canvasAllocation(
        request.viewport.width,
        request.viewport.height,
        requestedDpr
    );
    canvas.width = displayAllocation.width;
    canvas.height = displayAllocation.height;
    canvas.style.width = `${request.viewport.width}px`;
    canvas.style.height = `${request.viewport.height}px`;
    const displayContext = canvas.getContext("2d");
    if (!displayContext) {
        throw new Error("Context Canvas renderer could not create a 2D display context.");
    }
    const overscan = canvasOverscan(request, style);
    const baseWidth = request.viewport.width + overscan * 2;
    const baseHeight = request.viewport.height + overscan * 2;
    const baseAllocation = canvasAllocation(baseWidth, baseHeight, requestedDpr);
    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = baseAllocation.width;
    baseCanvas.height = baseAllocation.height;
    const context = baseCanvas.getContext("2d");
    if (!context) {
        throw new Error("Context Canvas renderer could not create a 2D base-raster context.");
    }
    context.setTransform(baseAllocation.dpr, 0, 0, baseAllocation.dpr, 0, 0);
    context.translate(overscan, overscan);
    drawCanvasReferenceFills(
        context,
        request,
        style,
        new Set(["sphere", "land", "water"])
    );
    const hasCartography = Boolean(
        request.scene.cartography && request.cartography.detail !== "none"
    );
    if (!hasCartography) {
        for (const feature of request.scene.backdrop.features) {
            if (
                !request.showNoDataBackdrop
                && !request.scene.entities.byFeatureKey.has(feature.key)
            ) {
                continue;
            }
            drawCanvasFeature(
                context,
                feature,
                request.baseTransform,
                request.pointSize ?? style.pointSize,
                { fill: style.fill, stroke: style.stroke, lineWidth: 1 }
            );
        }
    }
    const interactivePath = hasCartography
        ? createCanvasInteractivePath(request)
        : null;
    const referenceLines = createCanvasReferenceLines(request, style);
    const rasterDurationMs = measuredDuration(rasterStarted);

    const pickingStarted = performance.now();
    const pickingCanvas = document.createElement("canvas");
    const pickSize = pickingAllocation(baseWidth, baseHeight);
    pickingCanvas.width = pickSize.width;
    pickingCanvas.height = pickSize.height;
    const picking = pickingCanvas.getContext("2d", { willReadFrequently: true });
    if (!picking) {
        throw new Error("Context Canvas renderer could not create a 2D picking context.");
    }
    const pickingScaleX = pickSize.scaleX;
    const pickingScaleY = pickSize.scaleY;
    picking.setTransform(pickingScaleX, 0, 0, pickingScaleY, 0, 0);
    picking.translate(overscan, overscan);
    for (const feature of request.scene.backdrop.features) {
        const color = encodeFeatureColor(feature.index);
        drawCanvasFeature(
            picking,
            feature,
            request.baseTransform,
            request.pointSize ?? style.pointSize,
            {
                fill: `rgb(${color[0]},${color[1]},${color[2]})`,
                stroke: null,
                lineWidth: 0
            }
        );
    }
    const spatial = buildPickingIndex(
        request.scene,
        request.baseTransform,
        request.pointSize ?? style.pointSize,
        pickingScaleX,
        pickingScaleY,
        pickSize.width,
        pickSize.height,
        overscan,
        overscan,
        PICKING_BUCKET_SIZE
    );
    return {
        baseCanvas,
        referenceLines,
        interactivePath,
        overscan,
        displayContext,
        displayDpr: displayAllocation.dpr,
        rasterDurationMs,
        pickingDurationMs: measuredDuration(pickingStarted),
        picking: {
            context: picking,
            width: pickingCanvas.width,
            height: pickingCanvas.height,
            featuresByIndex: new Map(
                request.scene.backdrop.features.map((feature) => [feature.index, feature])
            ),
            scaleX: pickingScaleX,
            scaleY: pickingScaleY,
            offsetX: overscan,
            offsetY: overscan,
            ...spatial
        }
    };
}

function drawCanvasFeature(
    context: CanvasRenderingContext2D,
    feature: ContextFeature,
    transform: SceneTransform,
    pointSize: number,
    style: { readonly fill: string; readonly stroke: string | null; readonly lineWidth: number }
): void {
    context.beginPath();
    if (feature.geometry.points) {
        for (const raw of feature.geometry.points) {
            const point = projectPoint(raw, transform);
            context.moveTo(point.x + pointSize, point.y);
            context.arc(point.x, point.y, pointSize, 0, Math.PI * 2);
        }

    } else {
        for (const polygon of feature.geometry.polygons ?? []) {
            for (const ring of polygon) {
                ring.forEach((raw, index) => {
                    const point = projectPoint(raw, transform);
                    if (index === 0) {
                        context.moveTo(point.x, point.y);
                    } else {
                        context.lineTo(point.x, point.y);
                    }
                });
                context.closePath();
            }
        }

    }
    context.fillStyle = style.fill;
    context.fill("evenodd");
    if (style.stroke && style.lineWidth > 0) {
        context.strokeStyle = style.stroke;
        context.lineWidth = style.lineWidth;
        context.stroke();
    }
}

function drawCanvasReferenceFills(
    context: CanvasRenderingContext2D,
    request: ContextRenderRequest,
    style: ContextSurfaceStyle,
    roles: ReadonlySet<ContextMapLayer["role"]>
): void {
    for (const layer of request.scene.cartography?.layers ?? []) {
        if (!roles.has(layer.role) || !referenceLayerVisible(layer, request)) continue;
        const layerStyle = referenceStyle(layer, style);
        context.beginPath();
        for (const polygon of layer.polygons ?? []) {
            for (const ring of polygon) appendCanvasLine(context, ring, request.baseTransform, true);
        }
        for (const line of layer.lines ?? []) {
            appendCanvasLine(context, line, request.baseTransform, false);
        }
        if (layerStyle.fill) {
            context.fillStyle = layerStyle.fill;
            context.fill("evenodd");
        }
    }
}

function createCanvasReferenceLines(
    request: ContextRenderRequest,
    style: ContextSurfaceStyle
): readonly CanvasReferenceLine[] {
    const lines: CanvasReferenceLine[] = [];
    for (const layer of request.scene.cartography?.layers ?? []) {
        if (!referenceLayerVisible(layer, request)) continue;
        const layerStyle = referenceStyle(layer, style);
        if (!layerStyle.stroke || layerStyle.lineWidth <= 0) continue;
        lines.push({
            role: layer.role,
            path: new Path2D(referencePathData(layer, request.baseTransform)),
            stroke: layerStyle.stroke,
            lineWidth: layerStyle.lineWidth,
            placement: layer.role === "water"
                || layer.role === "river"
                || layer.role === "graticule"
                ? "underlay"
                : "overlay"
        });
    }

    return lines;
}

function createCanvasInteractivePath(request: ContextRenderRequest): Path2D {
    const commands = request.scene.backdrop.features
        .filter((feature) =>
            request.showNoDataBackdrop || request.scene.entities.byFeatureKey.has(feature.key))
        .map((feature) => pathData(feature, request.baseTransform))
        .join(" ");
    return new Path2D(commands);
}

function appendCanvasLine(
    context: CanvasRenderingContext2D,
    points: readonly ScenePoint[],
    transform: SceneTransform,
    closed: boolean
): void {
    points.forEach((raw, index) => {
        const point = projectPoint(raw, transform);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
    });
    if (closed) context.closePath();
}

function pathData(feature: ContextFeature, transform: SceneTransform): string {
    const commands: string[] = [];
    for (const polygon of feature.geometry.polygons ?? []) {
        for (const ring of polygon) {
            ring.forEach((raw, index) => {
                const point = projectPoint(raw, transform);
                commands.push(`${index === 0 ? "M" : "L"}${point.x},${point.y}`);
            });
            commands.push("Z");
        }
    }
    return commands.join(" ");
}

function hitPicking(picking: PickingState, x: number, y: number): ContextFeature | null {
    const pixelX = Math.floor((x + picking.offsetX) * picking.scaleX);
    const pixelY = Math.floor((y + picking.offsetY) * picking.scaleY);
    if (
        pixelX < 0
        || pixelY < 0
        || pixelX >= picking.width
        || pixelY >= picking.height
    ) {
        return null;
    }

    const data = picking.context.getImageData(pixelX, pixelY, 1, 1).data;
    const featureIndex = decodeFeatureColor(data[0], data[1], data[2]);
    if (featureIndex === null) {
        return null;
    }
    return picking.featuresByIndex.get(featureIndex) ?? null;
}

function buildPickingIndex(
    scene: ContextScene,
    transform: SceneTransform,
    pointRadius: number,
    scaleX: number,
    scaleY: number,
    width: number,
    height: number,
    offsetX: number,
    offsetY: number,
    initialBucketSize: number
): Pick<PickingState,
    "buckets"
    | "topmostByBucket"
    | "bucketSize"
    | "spatialBucketEntries"
    | "maxBucketOccupancy"
> {
    const entries = scene.backdrop.features.map((feature) => ({
        feature,
        bounds: pickingBounds(
            projectedFeatureBounds(feature, transform, pointRadius),
            scaleX,
            scaleY,
            width,
            height,
            offsetX,
            offsetY
        )
    }));
    let bucketSize = initialBucketSize;
    while (
        spatialReferenceCount(entries, bucketSize) > LIMITS.maxPickingSpatialReferences
        && bucketSize <= Math.max(width, height)
    ) {
        bucketSize *= 2;
    }
    const expectedReferences = spatialReferenceCount(entries, bucketSize);
    if (expectedReferences > LIMITS.maxPickingSpatialReferences) {
        throw new Error(
            `Context picking index requires ${expectedReferences} references, above the `
            + `${LIMITS.maxPickingSpatialReferences} scene safety budget.`
        );
    }
    const buckets = new Map<string, ContextFeature[]>();
    const topmostByBucket = new Map<string, ContextFeature>();
    let spatialBucketEntries = 0;
    let maxBucketOccupancy = 0;
    for (const entry of entries) {
        const minBucketX = Math.floor(entry.bounds.minX / bucketSize);
        const maxBucketX = Math.floor(entry.bounds.maxX / bucketSize);
        const minBucketY = Math.floor(entry.bounds.minY / bucketSize);
        const maxBucketY = Math.floor(entry.bounds.maxY / bucketSize);
        for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) {
            for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY++) {
                const key = `${bucketX}:${bucketY}`;
                const entries = buckets.get(key) ?? [];
                entries.push(entry.feature);
                topmostByBucket.set(key, entry.feature);
                spatialBucketEntries++;
                maxBucketOccupancy = Math.max(maxBucketOccupancy, entries.length);
                buckets.set(key, entries);
            }
        }
    }
    return {
        buckets,
        topmostByBucket,
        bucketSize,
        spatialBucketEntries,
        maxBucketOccupancy
    };
}

interface PickingIndexEntry {
    readonly feature: ContextFeature;
    readonly bounds: {
        readonly minX: number;
        readonly maxX: number;
        readonly minY: number;
        readonly maxY: number;
    };
}

function spatialReferenceCount(
    entries: readonly PickingIndexEntry[],
    bucketSize: number
): number {
    return entries.reduce((total, entry) => {
        const columns = Math.floor(entry.bounds.maxX / bucketSize)
            - Math.floor(entry.bounds.minX / bucketSize) + 1;
        const rows = Math.floor(entry.bounds.maxY / bucketSize)
            - Math.floor(entry.bounds.minY / bucketSize) + 1;
        return total + columns * rows;
    }, 0);
}

function pickingBounds(
    bounds: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number },
    scaleX: number,
    scaleY: number,
    width: number,
    height: number,
    offsetX: number,
    offsetY: number
): PickingIndexEntry["bounds"] {
    return {
        minX: Math.min(
            Math.max(Math.floor((bounds.minX + offsetX) * scaleX), 0),
            Math.max(width - 1, 0)
        ),
        maxX: Math.min(
            Math.max(Math.ceil((bounds.maxX + offsetX) * scaleX), 0),
            Math.max(width - 1, 0)
        ),
        minY: Math.min(
            Math.max(Math.floor((bounds.minY + offsetY) * scaleY), 0),
            Math.max(height - 1, 0)
        ),
        maxY: Math.min(
            Math.max(Math.ceil((bounds.maxY + offsetY) * scaleY), 0),
            Math.max(height - 1, 0)
        )
    };
}

function projectedFeatureBounds(
    feature: ContextFeature,
    transform: SceneTransform,
    pointRadius: number
): { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number } {
    const points = feature.geometry.points
        ?? feature.geometry.polygons?.flatMap((polygon) => polygon.flatMap((ring) => ring))
        ?? [feature.geometry.center];
    const projected = points.map((point) => projectPoint(point, transform));
    const padding = feature.geometry.points ? pointRadius : 0;
    return {
        minX: Math.min(...projected.map((point) => point.x)) - padding,
        maxX: Math.max(...projected.map((point) => point.x)) + padding,
        minY: Math.min(...projected.map((point) => point.y)) - padding,
        maxY: Math.max(...projected.map((point) => point.y)) + padding
    };
}

function pickingBucketKey(picking: PickingState, x: number, y: number): string {
    return `${Math.floor((x + picking.offsetX) * picking.scaleX / picking.bucketSize)}:`
        + `${Math.floor((y + picking.offsetY) * picking.scaleY / picking.bucketSize)}`;
}

function pickingCandidatesAt(
    picking: PickingState,
    bucketKey: string
): { readonly candidates: readonly ContextFeature[]; readonly referencesRead: number } {
    const local = picking.buckets.get(bucketKey) ?? [];
    const unique = new Map<number, ContextFeature>();
    for (const feature of local) {
        unique.set(feature.index, feature);
    }
    return { candidates: [...unique.values()], referencesRead: local.length };
}

interface CanvasHitMetrics {
    readonly sceneFeatures: number;
    pickingReads: number;
    candidateValidations: number;
    targetMapLookups: number;
    targetMapMisses: number;
    resolvedHits: number;
    pickedCandidatesDecoded: number;
    normalBucketChecks: number;
    normalCandidateValidationAttempts: number;
    normalPickingSuccesses: number;
    fallbackQueries: number;
    fallbackCandidateReferencesRead: number;
    fallbackCandidateValidations: number;
    maxFallbackCandidatesExamined: number;
    readonly spatialBucketEntries: number;
    readonly maxBucketOccupancy: number;
    readonly spatialReferenceBudget: number;
    readonly bucketSize: number;
    readonly pickingScaleX: number;
    readonly pickingScaleY: number;
    readonly displayBackingWidth: number;
    readonly displayBackingHeight: number;
    readonly baseRasterBackingWidth: number;
    readonly baseRasterBackingHeight: number;
    readonly pickingBackingWidth: number;
    readonly pickingBackingHeight: number;
    readonly totalBackingPixels: number;
}

interface InstrumentedContextRoot extends HTMLElement {
    __profileLensCanvasHitMetrics?: CanvasHitMetrics | null;
    __profileLensContextMetrics?: ContextPerformanceMetrics | null;
}

function setCanvasHitMetrics(root: HTMLElement, metrics: CanvasHitMetrics | null): void {
    Object.defineProperty(root as InstrumentedContextRoot, "__profileLensCanvasHitMetrics", {
        configurable: true,
        value: metrics,
        writable: false
    });
}

function setContextPerformanceMetrics(
    root: HTMLElement,
    metrics: ContextPerformanceMetrics | null
): void {
    Object.defineProperty(root as InstrumentedContextRoot, "__profileLensContextMetrics", {
        configurable: true,
        value: metrics,
        writable: false
    });
}

export function recordCanvasTargetMapLookup(root: HTMLElement, found: boolean): void {
    const metrics = (root as InstrumentedContextRoot).__profileLensCanvasHitMetrics;
    if (!metrics) {
        return;
    }
    metrics.targetMapLookups++;
    if (!found) {
        metrics.targetMapMisses++;
    }
}

export function canvasAllocation(
    cssWidth: number,
    cssHeight: number,
    requestedDpr: number
): { readonly width: number; readonly height: number; readonly dpr: number } {
    const width = Math.max(cssWidth, 1);
    const height = Math.max(cssHeight, 1);
    const cappedDpr = Math.min(Math.max(requestedDpr, 1), LIMITS.maxCanvasDpr);
    const dimensionDpr = Math.min(
        cappedDpr,
        LIMITS.maxCanvasDimension / width,
        LIMITS.maxCanvasDimension / height
    );
    const pixelDpr = Math.sqrt(LIMITS.maxCanvasBackingPixels / (width * height));
    const dpr = Math.max(Math.min(dimensionDpr, pixelDpr), 1 / Math.max(width, height));
    return {
        width: Math.max(Math.floor(width * dpr), 1),
        height: Math.max(Math.floor(height * dpr), 1),
        dpr
    };
}

export function pickingAllocation(
    cssWidth: number,
    cssHeight: number
): { readonly width: number; readonly height: number; readonly scaleX: number; readonly scaleY: number } {
    const allocation = canvasAllocation(cssWidth, cssHeight, 1);
    return {
        width: allocation.width,
        height: allocation.height,
        scaleX: allocation.width / Math.max(cssWidth, 1),
        scaleY: allocation.height / Math.max(cssHeight, 1)
    };
}

function clearCanvas(canvas: HTMLCanvasElement): void {
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.width = "0";
    canvas.style.height = "0";
    canvas.style.transform = "";
}

function clearSvg(svg: SVGElement): void {
    while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
    }
}

function clearElement(element: HTMLElement): void {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}
