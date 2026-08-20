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
    cameraFromPinchSnapshot,
    cameraToBasePoint,
    composeSceneTransform,
    homeZoomForBounds,
    inverseProjectPoint,
    panCamera,
    preserveCameraOnResize,
    projectPoint,
    createPinchSnapshot,
    resetCamera,
    resolveCameraHomeView,
    zoomCameraAt
} from "../src/context/viewport/camera";
import { contextSceneIdentity } from "../src/context/viewport/identity";
import { centerProbe } from "../src/context/viewport/probe";
import {
    createContextPerformanceMetrics,
    createContextSurface,
    renderContextSurface
} from "../src/render/contextSurface";
import { scene as createScene } from "../src/context/providers/common";

function polygonScene(offset = 0): ContextScene {
    return createScene("test-provider", "grid", [{
            index: 0,
            key: "entity:a",
            label: "A",
            description: "A grid cell",
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
        }]);
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
        const camera = resetCamera(limits.minZoom, limits, baseBounds, viewport);
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

    it("solves edge-bound pinch zoom and midpoint translation with one final clamp", () => {
        const viewport = { width: 200, height: 120 };
        const baseBounds = { minX: 8, maxX: 192, minY: 8, maxY: 112 };
        const limits = { minZoom: 1, maxZoom: 4, overscroll: 12 };
        const edgeCamera = clampCameraToBounds(
            { zoom: 2, panX: -999, panY: 999 },
            baseBounds,
            viewport,
            limits.overscroll
        );
        const startMidpoint = { x: 20, y: 100 };
        const snapshot = createPinchSnapshot(edgeCamera, startMidpoint);
        const midpoint = { x: 5, y: 115 };
        const result = cameraFromPinchSnapshot(
            snapshot,
            10,
            midpoint,
            limits,
            baseBounds,
            viewport
        );
        const expected = clampCameraToBounds({
            zoom: limits.maxZoom,
            panX: midpoint.x - snapshot.baseAnchor.x * limits.maxZoom,
            panY: midpoint.y - snapshot.baseAnchor.y * limits.maxZoom
        }, baseBounds, viewport, limits.overscroll);
        expect(result).toEqual(expected);
        const transformed = {
            minX: baseBounds.minX * result.zoom + result.panX,
            maxX: baseBounds.maxX * result.zoom + result.panX,
            minY: baseBounds.minY * result.zoom + result.panY,
            maxY: baseBounds.maxY * result.zoom + result.panY
        };
        expect(transformed.minX).toBeLessThanOrEqual(limits.overscroll);
        expect(transformed.maxX).toBeGreaterThanOrEqual(viewport.width - limits.overscroll);
        expect(transformed.minY).toBeLessThanOrEqual(limits.overscroll);
        expect(transformed.maxY).toBeGreaterThanOrEqual(viewport.height - limits.overscroll);
    });

    it("keeps min/max pinch clamps continuous from the gesture snapshot", () => {
        const viewport = { width: 240, height: 180 };
        const baseBounds = { minX: 8, maxX: 232, minY: 8, maxY: 172 };
        const limits = { minZoom: 1, maxZoom: 4, overscroll: 18 };
        const camera = { zoom: 2, panX: -120, panY: -90 };
        const midpoint = { x: 120, y: 90 };
        const snapshot = createPinchSnapshot(camera, midpoint);
        const maximum = cameraFromPinchSnapshot(
            snapshot,
            100,
            midpoint,
            limits,
            baseBounds,
            viewport
        );
        const beyondMaximum = cameraFromPinchSnapshot(
            snapshot,
            1_000,
            midpoint,
            limits,
            baseBounds,
            viewport
        );
        const minimum = cameraFromPinchSnapshot(
            snapshot,
            0.001,
            midpoint,
            limits,
            baseBounds,
            viewport
        );
        const beyondMinimum = cameraFromPinchSnapshot(
            snapshot,
            0.0001,
            midpoint,
            limits,
            baseBounds,
            viewport
        );
        expect(maximum.zoom).toBe(4);
        expect(beyondMaximum).toEqual(maximum);
        expect(minimum.zoom).toBe(1);
        expect(beyondMinimum).toEqual(minimum);

        const shifted = cameraFromPinchSnapshot(
            snapshot,
            100,
            { x: midpoint.x + 1, y: midpoint.y + 1 },
            limits,
            baseBounds,
            viewport
        );
        expect(shifted.zoom).toBe(maximum.zoom);
        expect(Math.abs(shifted.panX - maximum.panX)).toBeLessThanOrEqual(1);
        expect(Math.abs(shifted.panY - maximum.panY)).toBeLessThanOrEqual(1);
    });

    it("clamps zoom and pan without allowing the scene to be lost", () => {
        const viewport = { width: 200, height: 120 };
        const baseBounds = { minX: 8, maxX: 192, minY: 8, maxY: 112 };
        const limits = { minZoom: 1, maxZoom: 4, overscroll: 12 };
        const reset = resetCamera(limits.minZoom, limits, baseBounds, viewport);
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

    it("does not re-anchor a fractional camera already at either zoom limit", () => {
        const viewport = { width: 320, height: 300 };
        const baseBounds = { minX: 8, maxX: 312, minY: 8, maxY: 292 };
        const limits = { minZoom: 1.3, maxZoom: 7.3, overscroll: 24 };
        const maximum = clampCameraToBounds(
            { zoom: 7.3, panX: -1008, panY: -938.7 },
            baseBounds,
            viewport,
            limits.overscroll
        );
        const minimum = clampCameraToBounds(
            { zoom: 1.3, panX: -48.2, panY: -39.1 },
            baseBounds,
            viewport,
            limits.overscroll
        );
        expect(zoomCameraAt(
            maximum,
            1.2,
            { x: 1, y: 149 },
            limits,
            baseBounds,
            viewport
        )).toEqual(maximum);
        expect(zoomCameraAt(
            minimum,
            0.8,
            { x: 319, y: 151 },
            limits,
            baseBounds,
            viewport
        )).toEqual(minimum);
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
                resetCamera(oldLimits.minZoom, oldLimits, oldBounds, oldViewport),
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

    it("resolves Automatic home view to Fill only for eligible geographic navigation", () => {
        for (const mode of ["builtInPack", "points", "boundGeometry"] as const) {
            expect(resolveCameraHomeView("automatic", mode, true)).toBe("fill");
        }
        for (const mode of ["none", "grid", "hex"] as const) {
            expect(resolveCameraHomeView("automatic", mode, true)).toBe("fit");
        }
        expect(resolveCameraHomeView("automatic", "builtInPack", false)).toBe("fit");
        expect(resolveCameraHomeView("fit", "builtInPack", true)).toBe("fit");
        expect(resolveCameraHomeView("fill", "none", false)).toBe("fill");
    });

    it("separates fitted minimum zoom from fill home zoom for wide and tall scenes", () => {
        const limits = { minZoom: 1, maxZoom: 8, overscroll: 24 };
        const cases = [
            {
                viewport: { width: 1600, height: 900 },
                baseBounds: { minX: 8, maxX: 1592, minY: 54, maxY: 846 },
                panAxis: "panY" as const
            },
            {
                viewport: { width: 520, height: 900 },
                baseBounds: { minX: 98, maxX: 422, minY: 8, maxY: 892 },
                panAxis: "panX" as const
            }
        ];
        for (const value of cases) {
            const fitZoom = homeZoomForBounds(
                "fit",
                limits,
                value.baseBounds,
                value.viewport
            );
            const fillZoom = homeZoomForBounds(
                "fill",
                limits,
                value.baseBounds,
                value.viewport
            );
            expect(fitZoom).toBe(1);
            expect(fillZoom).toBeGreaterThan(fitZoom);
            const home = resetCamera(fillZoom, limits, value.baseBounds, value.viewport);
            const moved = panCamera(
                home,
                value.panAxis === "panX" ? 120 : 0,
                value.panAxis === "panY" ? 120 : 0,
                limits,
                value.baseBounds,
                value.viewport
            );
            expect(Math.abs(moved[value.panAxis] - home[value.panAxis])).toBeGreaterThan(10);
            const fit = resetCamera(fitZoom, limits, value.baseBounds, value.viewport);
            expect(fit.zoom).toBe(limits.minZoom);
        }
    });

    it("clamps fill home zoom and resets exactly to the configured home", () => {
        const viewport = { width: 1200, height: 400 };
        const baseBounds = { minX: 8, maxX: 1192, minY: 180, maxY: 220 };
        const limits = { minZoom: 1.25, maxZoom: 3, overscroll: 24 };
        const homeZoom = homeZoomForBounds("fill", limits, baseBounds, viewport);
        expect(homeZoom).toBe(3);
        const home = resetCamera(homeZoom, limits, baseBounds, viewport);
        const moved = panCamera(home, -200, 100, limits, baseBounds, viewport);
        expect(moved).not.toEqual(home);
        expect(resetCamera(homeZoom, limits, baseBounds, viewport)).toEqual(home);
        expect(home.zoom).toBe(3);
    });

    it("ignores degenerate axes when resolving fill zoom", () => {
        const viewport = { width: 800, height: 500 };
        const limits = { minZoom: 1, maxZoom: 8, overscroll: 24 };
        expect(homeZoomForBounds(
            "fill",
            limits,
            { minX: 8, maxX: 792, minY: 250, maxY: 250 },
            viewport
        )).toBe(1);
        expect(homeZoomForBounds(
            "fill",
            limits,
            { minX: 400, maxX: 400, minY: 8, maxY: 492 },
            viewport
        )).toBe(1);
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
            backdrop: {
                ...first.backdrop,
                features: first.backdrop.features.map((feature) => ({
                    ...feature,
                    label: "Renamed"
                }))
            },
            entities: {
                byFeatureKey: new Map([[
                    "entity:a",
                    {
                        featureKey: "entity:a",
                        entityIndex: 0,
                        entityKey: "changed",
                        entityLabel: "Renamed",
                        selection: { key: "new-selection", hostIdentity: { changed: true } },
                        contextValue: null,
                        tooltipValues: []
                    }
                ]]),
                featureKeyByEntityKey: new Map([["changed", "entity:a"]])
            }
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
            paintIdentity: "same-paint",
            viewport: { width: 200, height: 120 },
            baseTransform: {
                scale: 5,
                translateX,
                translateY: 10,
                invertY: false
            },
            camera: { zoom: 1, panX: 0, panY: 0 },
            focusedFeatureKey: null,
            selectedFeatureKeys: new Set<string>(),
            showNoDataBackdrop: true,
            interactive: true,
            cartography: {
                detail: "standard" as const,
                showPhysicalLayers: true,
                showLabels: true,
                showGraticule: true,
                labelDensity: "balanced" as const
            },
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
            pointSize: 6,
            ocean: "#def",
            land: "#eee",
            water: "#cde",
            waterOutline: "#79a",
            waterOutlineWidth: 0.35,
            river: "#79a",
            graticule: "#abc",
            coastline: "#555",
            admin: "#999",
            mapLabel: "#222",
            mapLabelHalo: "#fff"
        };
        renderContextSurface(elements, request(10), "svg", style, 1, metrics);
        const first = elements.svg.querySelector("[data-context-key]")?.getAttribute("d");
        renderContextSurface(elements, request(100), "svg", style, 1, metrics);
        const second = elements.svg.querySelector("[data-context-key]")?.getAttribute("d");
        expect(second).not.toBe(first);
        expect(second).toContain("100");
        expect(metrics.svgGeometryBuilds).toBe(2);
    });

    it("keeps hidden no-data backdrop probeable, semantic, and focusable", () => {
        const parent = document.createElement("div");
        const elements = createContextSurface(parent);
        const features = [
            {
                index: 0,
                key: "bound",
                label: "Bound",
                description: "Bound feature",
                geometry: {
                    kind: "grid" as const,
                    center: { x: 0.5, y: 0.5 },
                    polygons: [[[
                        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 },
                        { x: 0, y: 1 }, { x: 0, y: 0 }
                    ]]]
                }
            },
            {
                index: 1,
                key: "unbound",
                label: "Unbound",
                description: "Unbound feature",
                geometry: {
                    kind: "grid" as const,
                    center: { x: 1.5, y: 0.5 },
                    polygons: [[[
                        { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 },
                        { x: 1, y: 1 }, { x: 1, y: 0 }
                    ]]]
                }
            }
        ];
        const value = createScene("test", "grid", features, [{
            featureKey: "bound",
            entityIndex: 0,
            entityKey: "entity:0",
            entityLabel: "Bound",
            selection: null,
            contextValue: null,
            tooltipValues: []
        }]);
        const request = {
            scene: value,
            sceneIdentity: "hidden-backdrop",
            paintIdentity: "bound-only:bound",
            viewport: { width: 200, height: 100 },
            baseTransform: {
                scale: 80,
                translateX: 20,
                translateY: 10,
                invertY: false
            },
            camera: { zoom: 1, panX: 0, panY: 0 },
            focusedFeatureKey: "unbound",
            selectedFeatureKeys: new Set<string>(),
            featureDescriptions: new Map([
                ["bound", "Bound feature. Profile data available."],
                ["unbound", "Unbound feature. No data in current report context."]
            ]),
            showNoDataBackdrop: false,
            interactive: true,
            cartography: {
                detail: "standard" as const,
                showPhysicalLayers: true,
                showLabels: true,
                showGraticule: true,
                labelDensity: "balanced" as const
            },
            navigation: {
                enabled: true,
                showProbe: true,
                showResetControl: true,
                showGestureHelp: true,
                resetLabel: "Reset",
                probeDescription: "Probe",
                gestureHelp: "Help"
            },
            pointSize: 6
        };
        const rendered = renderContextSurface(
            elements,
            request,
            "svg",
            {
                fill: "#ddd",
                stroke: "#333",
                selected: "#08f",
                background: "#fff",
                pointSize: 6,
                ocean: "#def",
                land: "#eee",
                water: "#cde",
                waterOutline: "#79a",
                waterOutlineWidth: 0.35,
                river: "#79a",
                graticule: "#abc",
                coastline: "#555",
                admin: "#999",
                mapLabel: "#222",
                mapLabelHalo: "#fff"
            },
            1,
            createContextPerformanceMetrics()
        );
        expect(elements.svg.querySelector("[data-context-key='unbound']")
            ?.getAttribute("visibility")).toBe("hidden");
        expect(rendered.hitTest(140, 50)?.featureKey).toBe("unbound");
        expect(elements.svg.querySelector(".profile-lens-context-outline")).not.toBeNull();
        expect(elements.semantic.textContent).toBe("");
        expect(elements.semantic.querySelector("[id='context:unbound']")
            ?.getAttribute("aria-label")).toContain("No data");
    });
});
