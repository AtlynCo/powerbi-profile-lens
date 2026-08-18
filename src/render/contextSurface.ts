import { LIMITS } from "../model/contract";
import type {
    ContextFeature,
    ContextHit,
    ContextRenderRequest,
    ContextRendererKind,
    ContextScene,
} from "../context/contract";
import {
    decodeFeatureColor,
    encodeFeatureColor,
    hitTestFeature,
    hitTestScene
} from "../context/hitTest";
import { projectPoint } from "../context/projection";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface ContextSurfaceElements {
    readonly root: HTMLElement;
    readonly canvas: HTMLCanvasElement;
    readonly svg: SVGSVGElement;
    readonly semantic: HTMLElement;
    readonly attribution: HTMLElement;
}

export interface ContextSurfaceStyle {
    readonly fill: string;
    readonly stroke: string;
    readonly selected: string;
    readonly background: string;
    readonly pointSize: number;
}

export interface RenderedContextSurface {
    readonly kind: ContextRendererKind;
    readonly hitTest: (x: number, y: number) => ContextHit | null;
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
    root.append(canvas, svg, semantic, attribution);
    parent.insertBefore(root, parent.firstChild);
    return { root, canvas, svg, semantic, attribution };
}

export function renderContextSurface(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest,
    kind: ContextRendererKind,
    style: ContextSurfaceStyle,
    devicePixelRatio: number
): RenderedContextSurface {
    elements.root.removeAttribute("hidden");
    elements.root.setAttribute("aria-setsize", String(request.scene.features.length));
    renderAttribution(elements, request.scene);
    renderSemanticOptions(elements, request);
    if (kind === "svg") {
        setCanvasHitMetrics(elements.root, null);
        renderSvg(elements, request, style);
        clearCanvas(elements.canvas);
        return {
            kind,
            hitTest: (x, y) => hitTestScene(
                request.scene,
                request.transform,
                x,
                y,
                style.pointSize
            )
        };
    }
    const picking = renderCanvas(elements, request, style, devicePixelRatio);
    const metrics: CanvasHitMetrics = {
        sceneFeatures: request.scene.features.length,
        pickingReads: 0,
        candidateValidations: 0,
        fullSceneScans: 0,
        targetMapLookups: 0,
        pickingScaleX: picking.scaleX,
        pickingScaleY: picking.scaleY
    };
    setCanvasHitMetrics(elements.root, metrics);
    renderOverlay(elements.svg, request, style);
    return {
        kind,
        hitTest: (x, y) => {
            metrics.pickingReads++;
            const picked = hitPicking(picking, x, y);
            if (!picked) {
                return null;
            }
            metrics.candidateValidations++;
            return hitTestFeature(
                picked,
                request.transform,
                x,
                y,
                style.pointSize
            )
                ? { featureIndex: picked.index, featureKey: picked.key }
                : null;
        }
    };
}

export function hideContextSurface(elements: ContextSurfaceElements): void {
    elements.root.setAttribute("hidden", "hidden");
    clearCanvas(elements.canvas);
    clearSvg(elements.svg);
    clearElement(elements.semantic);
    clearElement(elements.attribution);
}

function renderAttribution(elements: ContextSurfaceElements, scene: ContextScene): void {
    const metadata = scene.metadata;
    if (!metadata) {
        elements.attribution.setAttribute("hidden", "hidden");
        elements.attribution.textContent = "";
        elements.root.removeAttribute("aria-description");
        return;
    }
    const text = `${metadata.displayName}; ${metadata.vintage}; ${metadata.attribution}`;
    elements.attribution.textContent = text;
    elements.attribution.removeAttribute("hidden");
    elements.root.setAttribute("aria-description", text);
}

function renderSemanticOptions(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest
): void {
    clearElement(elements.semantic);
    const focusedIndex = Math.max(
        request.scene.features.findIndex((feature) => feature.key === request.focusedKey),
        0
    );
    const maxOptions = 100;
    const start = Math.max(
        Math.min(focusedIndex - Math.floor(maxOptions / 2), request.scene.features.length - maxOptions),
        0
    );
    const retained = request.scene.features.slice(start, start + maxOptions);
    for (const feature of retained) {
        const option = document.createElement("div");
        option.id = `context:${feature.key}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-label", feature.description);
        option.setAttribute(
            "aria-selected",
            request.selectedKeys.has(feature.key) || feature.key === request.focusedKey ? "true" : "false"
        );
        option.setAttribute("aria-posinset", String(feature.index + 1));
        option.setAttribute("aria-setsize", String(request.scene.features.length));
        elements.semantic.appendChild(option);
    }
    const focused = retained.find((feature) => feature.key === request.focusedKey) ?? retained[0];
    if (focused) {
        elements.root.setAttribute("aria-activedescendant", `context:${focused.key}`);
    } else {
        elements.root.removeAttribute("aria-activedescendant");
    }
}

interface PickingState {
    readonly context: CanvasRenderingContext2D | null;
    readonly width: number;
    readonly height: number;
    readonly featuresByIndex: ReadonlyMap<number, ContextFeature>;
    readonly scaleX: number;
    readonly scaleY: number;
}

function renderSvg(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest,
    style: ContextSurfaceStyle
): void {
    const svg = elements.svg;
    clearSvg(svg);
    svg.setAttribute("width", String(request.viewport.width));
    svg.setAttribute("height", String(request.viewport.height));
    svg.setAttribute("viewBox", `0 0 ${request.viewport.width} ${request.viewport.height}`);
    for (const feature of request.scene.features) {
        const node = createSvgFeature(feature, request, style);
        node.setAttribute("data-context-key", feature.key);
        node.setAttribute("aria-hidden", "true");
        svg.appendChild(node);
    }
    appendOverlay(svg, request, style);
}

function renderOverlay(
    svg: SVGSVGElement,
    request: ContextRenderRequest,
    style: ContextSurfaceStyle
): void {
    clearSvg(svg);
    svg.setAttribute("width", String(request.viewport.width));
    svg.setAttribute("height", String(request.viewport.height));
    svg.setAttribute("viewBox", `0 0 ${request.viewport.width} ${request.viewport.height}`);
    appendOverlay(svg, request, style);
}

function appendOverlay(
    svg: SVGSVGElement,
    request: ContextRenderRequest,
    style: ContextSurfaceStyle
): void {
    const focused = request.scene.features.find((feature) => feature.key === request.focusedKey);
    if (focused && request.connectorTarget) {
        const center = projectPoint(focused.geometry.center, request.transform);
        const line = document.createElementNS(SVG_NS, "line");
        line.classList.add("profile-lens-context-connector");
        line.setAttribute("x1", String(center.x));
        line.setAttribute("y1", String(center.y));
        line.setAttribute("x2", String(request.connectorTarget.x));
        line.setAttribute("y2", String(request.connectorTarget.y));
        line.setAttribute("stroke", style.selected);
        line.setAttribute("stroke-width", "2");
        line.setAttribute("stroke-dasharray", "4 3");
        line.setAttribute("aria-hidden", "true");
        svg.appendChild(line);
    }
    for (const feature of request.scene.features) {
        if (!request.selectedKeys.has(feature.key) && feature.key !== request.focusedKey) {
            continue;
        }
        const overlay = createSvgFeature(feature, request, style);
        overlay.classList.add("profile-lens-context-outline");
        overlay.setAttribute("fill", "none");
        overlay.setAttribute("stroke", style.selected);
        overlay.setAttribute("stroke-width", "3");
        overlay.setAttribute("pointer-events", "none");
        overlay.setAttribute("aria-hidden", "true");
        svg.appendChild(overlay);
    }
}

function createSvgFeature(
    feature: ContextFeature,
    request: ContextRenderRequest,
    style: ContextSurfaceStyle
): SVGElement {
    if (feature.geometry.points) {
        const group = document.createElementNS(SVG_NS, "g");
        for (const raw of feature.geometry.points) {
            const point = projectPoint(raw, request.transform);
            const circle = document.createElementNS(SVG_NS, "circle");
            circle.setAttribute("cx", String(point.x));
            circle.setAttribute("cy", String(point.y));
            circle.setAttribute("r", String(style.pointSize));
            group.appendChild(circle);
        }
        applySvgStyle(group, feature, request, style);
        return group;
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData(feature, request));
    path.setAttribute("fill-rule", "evenodd");
    applySvgStyle(path, feature, request, style);
    return path;
}

function applySvgStyle(
    element: SVGElement,
    feature: ContextFeature,
    request: ContextRenderRequest,
    style: ContextSurfaceStyle
): void {
    element.setAttribute("fill", style.fill);
    element.setAttribute(
        "stroke",
        request.selectedKeys.has(feature.key) || request.focusedKey === feature.key
            ? style.selected
            : style.stroke
    );
    element.setAttribute(
        "stroke-width",
        request.selectedKeys.has(feature.key) || request.focusedKey === feature.key ? "3" : "1"
    );
}

function renderCanvas(
    elements: ContextSurfaceElements,
    request: ContextRenderRequest,
    style: ContextSurfaceStyle,
    requestedDpr: number
): PickingState {
    const canvas = elements.canvas;
    const allocation = canvasAllocation(request.viewport.width, request.viewport.height, requestedDpr);
    canvas.width = allocation.width;
    canvas.height = allocation.height;
    canvas.style.width = `${request.viewport.width}px`;
    canvas.style.height = `${request.viewport.height}px`;
    const context = canvas.getContext("2d");
    context?.setTransform(allocation.dpr, 0, 0, allocation.dpr, 0, 0);
    context?.clearRect(0, 0, request.viewport.width, request.viewport.height);

    const pickingCanvas = document.createElement("canvas");
    const pickSize = pickingAllocation(request.viewport.width, request.viewport.height);
    pickingCanvas.width = pickSize.width;
    pickingCanvas.height = pickSize.height;
    const picking = pickingCanvas.getContext("2d", { willReadFrequently: true });
    const pickingScaleX = pickSize.scaleX;
    const pickingScaleY = pickSize.scaleY;
    picking?.setTransform(pickingScaleX, 0, 0, pickingScaleY, 0, 0);
    for (const feature of request.scene.features) {
        drawCanvasFeature(context, feature, request, {
            fill: style.fill,
            stroke: request.selectedKeys.has(feature.key) || request.focusedKey === feature.key
                ? style.selected
                : style.stroke,
            lineWidth: request.selectedKeys.has(feature.key) || request.focusedKey === feature.key ? 3 : 1
        });
        const color = encodeFeatureColor(feature.index);
        drawCanvasFeature(picking, feature, request, {
            fill: `rgb(${color[0]},${color[1]},${color[2]})`,
            stroke: `rgb(${color[0]},${color[1]},${color[2]})`,
            lineWidth: 5
        });
    }
    return {
        context: picking,
        width: pickingCanvas.width,
        height: pickingCanvas.height,
        featuresByIndex: new Map(request.scene.features.map((feature) => [feature.index, feature])),
        scaleX: pickingScaleX,
        scaleY: pickingScaleY
    };
}

function drawCanvasFeature(
    context: CanvasRenderingContext2D | null,
    feature: ContextFeature,
    request: ContextRenderRequest,
    style: { readonly fill: string; readonly stroke: string; readonly lineWidth: number }
): void {
    if (!context) {
        return;
    }
    context.beginPath();
    if (feature.geometry.points) {
        for (const raw of feature.geometry.points) {
            const point = projectPoint(raw, request.transform);
            context.moveTo(point.x + requestPointSize(request), point.y);
            context.arc(point.x, point.y, requestPointSize(request), 0, Math.PI * 2);
        }

        function requestPointSize(request: ContextRenderRequest): number {
            return request.pointSize ?? 5;
        }
    } else {
        for (const polygon of feature.geometry.polygons ?? []) {
            for (const ring of polygon) {
                ring.forEach((raw, index) => {
                    const point = projectPoint(raw, request.transform);
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
    context.strokeStyle = style.stroke;
    context.lineWidth = style.lineWidth;
    context.fill("evenodd");
    context.stroke();
}

function pathData(feature: ContextFeature, request: ContextRenderRequest): string {
    const commands: string[] = [];
    for (const polygon of feature.geometry.polygons ?? []) {
        for (const ring of polygon) {
            ring.forEach((raw, index) => {
                const point = projectPoint(raw, request.transform);
                commands.push(`${index === 0 ? "M" : "L"}${point.x},${point.y}`);
            });
            commands.push("Z");
        }
    }
    return commands.join(" ");
}

function hitPicking(picking: PickingState, x: number, y: number): ContextFeature | null {
    const pixelX = Math.floor(x * picking.scaleX);
    const pixelY = Math.floor(y * picking.scaleY);
    if (
        !picking.context
        || pixelX < 0
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

interface CanvasHitMetrics {
    readonly sceneFeatures: number;
    pickingReads: number;
    candidateValidations: number;
    readonly fullSceneScans: 0;
    targetMapLookups: number;
    readonly pickingScaleX: number;
    readonly pickingScaleY: number;
}

interface InstrumentedContextRoot extends HTMLElement {
    __profileLensCanvasHitMetrics?: CanvasHitMetrics | null;
}

function setCanvasHitMetrics(root: HTMLElement, metrics: CanvasHitMetrics | null): void {
    Object.defineProperty(root as InstrumentedContextRoot, "__profileLensCanvasHitMetrics", {
        configurable: true,
        value: metrics,
        writable: false
    });
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
}

function clearSvg(svg: SVGSVGElement): void {
    while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
    }
}

function clearElement(element: HTMLElement): void {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}
