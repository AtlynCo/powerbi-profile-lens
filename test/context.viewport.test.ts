import { describe, expect, it } from "vitest";
import type { ContextScene, SceneTransform } from "../src/context/contract";
import { fitScene } from "../src/context/projection";
import {
    clampCameraToBounds,
    projectBounds,
    sceneBounds,
    viewportOverscroll
} from "../src/context/viewport/bounds";
import {
    cameraToBasePoint,
    composeSceneTransform,
    inverseProjectPoint,
    panCamera,
    preserveCameraOnResize,
    projectPoint,
    resetCamera,
    zoomCameraAt
} from "../src/context/viewport/camera";
import { contextSceneIdentity } from "../src/context/viewport/identity";
import { centerProbe } from "../src/context/viewport/probe";
import {
    createContextPerformanceMetrics,
    createContextSurface,
    renderContextSurface
} from "../src/render/contextSurface";

function polygonScene(offset = 0): ContextScene {
    return {
        providerId: "test-provider",
        mode: "grid",
        features: [{
            index: 0,
            key: "entity:a",
            entityIndex: 0,
            label: "A",
            description: "A grid cell",
            selection: { key: "a", hostIdentity: null },
            contextValue: null,
            tooltipValues: [],
            geometry: {
                kind: "grid",
                center: { x: 5 + offset, y: 5 },
                polygons: [[[
                    { x: offset, y: 0 },
                    { x: 10 + offset, y: 0 },
                    { x: 10 + offset, y: 10 },
                    { x: offset, y: 10 },
                    { x: offset, y: 0 }
                ]]]
            }
        }],
        metrics: { featureCount: 1, ringCount: 1, vertexCount: 5 },
        diagnostics: [],
        partial: false
    };
}

describe("context viewport camera", () => {
    it("composes and inverts finite transforms in both Y orientations", () => {
        for (const invertY of [false, true]) {
            const base: SceneTransform = {
                scale: 3,
                translateX: 12,
                translateY: 80,
                invertY
            };
            const effective = composeSceneTransform(base, {
                zoom: 2,
                panX: -15,
                panY: 9
            });
            const scene = { x: 7, y: -4 };
            const screen = projectPoint(scene, effective);
            expect(inverseProjectPoint(screen, effective).x).toBeCloseTo(scene.x, 12);
            expect(inverseProjectPoint(screen, effective).y).toBeCloseTo(scene.y, 12);
            expect(effective).toMatchObject({
                scale: 6,
                translateX: 9,
                translateY: 169,
                invertY
            });
        }
    });

    it("preserves the base and scene point beneath an anchored zoom", () => {
        const scene = polygonScene();
        const viewport = { width: 240, height: 180 };
        const base = fitScene(scene, viewport);
        const rawBounds = sceneBounds(scene);
        expect(rawBounds).not.toBeNull();
        const baseBounds = projectBounds(rawBounds!, base);
        const limits = {
            minZoom: 1,
            maxZoom: 8,
            overscroll: viewportOverscroll(viewport)
        };
        const camera = resetCamera(limits, baseBounds, viewport);
        const anchor = { x: 120, y: 90 };
        const beforeBase = cameraToBasePoint(anchor, camera);
        const beforeScene = inverseProjectPoint(anchor, composeSceneTransform(base, camera));
        const zoomed = zoomCameraAt(camera, 2.5, anchor, limits, baseBounds, viewport);
        const afterBase = cameraToBasePoint(anchor, zoomed);
        const afterScene = inverseProjectPoint(anchor, composeSceneTransform(base, zoomed));
        expect(afterBase.x).toBeCloseTo(beforeBase.x, 12);
        expect(afterBase.y).toBeCloseTo(beforeBase.y, 12);
        expect(afterScene.x).toBeCloseTo(beforeScene.x, 12);
        expect(afterScene.y).toBeCloseTo(beforeScene.y, 12);
    });

    it("clamps zoom and pan without allowing the scene to be lost", () => {
        const viewport = { width: 200, height: 120 };
        const baseBounds = { minX: 8, maxX: 192, minY: 8, maxY: 112 };
        const limits = { minZoom: 1, maxZoom: 4, overscroll: 12 };
        const reset = resetCamera(limits, baseBounds, viewport);
        const zoomed = zoomCameraAt(
            reset,
            100,
            { x: 100, y: 60 },
            limits,
            baseBounds,
            viewport
        );
        expect(zoomed.zoom).toBe(4);
        const panned = panCamera(
            zoomed,
            100_000,
            -100_000,
            limits,
            baseBounds,
            viewport
        );
        const transformed = {
            minX: baseBounds.minX * panned.zoom + panned.panX,
            maxX: baseBounds.maxX * panned.zoom + panned.panX,
            minY: baseBounds.minY * panned.zoom + panned.panY,
            maxY: baseBounds.maxY * panned.zoom + panned.panY
        };
        expect(transformed.minX).toBeLessThanOrEqual(limits.overscroll);
        expect(transformed.maxX).toBeGreaterThanOrEqual(viewport.width - limits.overscroll);
        expect(transformed.minY).toBeLessThanOrEqual(limits.overscroll);
        expect(transformed.maxY).toBeGreaterThanOrEqual(viewport.height - limits.overscroll);
        expect(clampCameraToBounds(panned, baseBounds, viewport, limits.overscroll))
            .toEqual(panned);
    });

    it("preserves the viewed scene center across a valid resize", () => {
        const scene = polygonScene();
        const oldViewport = { width: 400, height: 260 };
        const newViewport = { width: 760, height: 420 };
        const oldBase = fitScene(scene, oldViewport);
        const newBase = fitScene(scene, newViewport);
        const rawBounds = sceneBounds(scene)!;
        const oldBounds = projectBounds(rawBounds, oldBase);
        const newBounds = projectBounds(rawBounds, newBase);
        const oldLimits = {
            minZoom: 1,
            maxZoom: 8,
            overscroll: viewportOverscroll(oldViewport)
        };
        const oldCamera = panCamera(
            zoomCameraAt(
                resetCamera(oldLimits, oldBounds, oldViewport),
                3,
                { x: 200, y: 130 },
                oldLimits,
                oldBounds,
                oldViewport
            ),
            -70,
            25,
            oldLimits,
            oldBounds,
            oldViewport
        );
        const oldCenter = inverseProjectPoint(
            { x: oldViewport.width / 2, y: oldViewport.height / 2 },
            composeSceneTransform(oldBase, oldCamera)
        );
        const nextLimits = {
            ...oldLimits,
            overscroll: viewportOverscroll(newViewport)
        };
        const resized = preserveCameraOnResize(
            oldCamera,
            oldBase,
            newBase,
            oldViewport,
            newViewport,
            newBounds,
            nextLimits
        );
        expect(resized).not.toBeNull();
        const newCenter = inverseProjectPoint(
            { x: newViewport.width / 2, y: newViewport.height / 2 },
            composeSceneTransform(newBase, resized!)
        );
        expect(newCenter.x).toBeCloseTo(oldCenter.x, 10);
        expect(newCenter.y).toBeCloseTo(oldCenter.y, 10);
        expect(resized?.zoom).toBe(oldCamera.zoom);
    });

    it("rejects invalid resize transitions instead of propagating non-finite state", () => {
        expect(preserveCameraOnResize(
            { zoom: 2, panX: 0, panY: 0 },
            { scale: 1, translateX: 0, translateY: 0, invertY: false },
            { scale: 1, translateX: 0, translateY: 0, invertY: false },
            { width: 0, height: 100 },
            { width: 100, height: 100 },
            { minX: 0, maxX: 100, minY: 0, maxY: 100 },
            { minZoom: 1, maxZoom: 8, overscroll: 10 }
        )).toBeNull();
    });

    it("keeps the fixed probe at center while deriving its scene point", () => {
        const probe = centerProbe(
            { width: 80, height: 120 },
            { scale: 2, translateX: 10, translateY: 20, invertY: false }
        );
        expect(probe.screen).toEqual({ x: 40, y: 60 });
        expect(probe.scene).toEqual({ x: 15, y: 20 });
    });

    it("identifies compatible scenes independently of labels and host selection", () => {
        const first = polygonScene();
        const relabeled: ContextScene = {
            ...first,
            features: first.features.map((feature) => ({
                ...feature,
                label: "Renamed",
                selection: { key: "new-selection", hostIdentity: { changed: true } }
            }))
        };
        expect(contextSceneIdentity(relabeled)).toBe(contextSceneIdentity(first));
        expect(contextSceneIdentity(polygonScene(1))).not.toBe(contextSceneIdentity(first));
    });

    it("rebuilds cached SVG geometry when the immutable base transform changes", () => {
        const parent = document.createElement("div");
        const elements = createContextSurface(parent);
        const scene = polygonScene();
        const metrics = createContextPerformanceMetrics();
        const request = (translateX: number) => ({
            scene,
            sceneIdentity: "same-scene",
            viewport: { width: 200, height: 120 },
            baseTransform: {
                scale: 5,
                translateX,
                translateY: 10,
                invertY: false
            },
            camera: { zoom: 1, panX: 0, panY: 0 },
            focusedKey: null,
            selectedKeys: new Set<string>(),
            interactive: true,
            navigation: {
                enabled: false,
                showProbe: true,
                showResetControl: true,
                showGestureHelp: true,
                resetLabel: "Reset",
                probeDescription: "Probe",
                gestureHelp: "Help"
            },
            pointSize: 6
        });
        const style = {
            fill: "#ddd",
            stroke: "#333",
            selected: "#08f",
            background: "#fff",
            pointSize: 6
        };
        renderContextSurface(elements, request(10), "svg", style, 1, metrics);
        const first = elements.svg.querySelector("[data-context-key]")?.getAttribute("d");
        renderContextSurface(elements, request(100), "svg", style, 1, metrics);
        const second = elements.svg.querySelector("[data-context-key]")?.getAttribute("d");
        expect(second).not.toBe(first);
        expect(second).toContain("100");
        expect(metrics.svgGeometryBuilds).toBe(2);
    });
});
