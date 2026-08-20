import { describe, expect, it } from "vitest";
import type {
    ContextCartography,
    ContextRenderRequest,
    ContextScene
} from "../src/context/contract";
import { scene } from "../src/context/providers/common";
import {
    createContextPerformanceMetrics,
    createContextSurface,
    renderContextSurface
} from "../src/render/contextSurface";
import { defaultSettings } from "../src/formatting";
import { resolveTheme } from "../src/render/theme";

const polygon = [[[
    { x: 20, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 80 },
    { x: 20, y: 80 },
    { x: 20, y: 20 }
]]];

function cartography(labels = 1): ContextCartography {
    return {
        layers: [
            { id: "sphere", role: "sphere", polygons: polygon },
            { id: "land", role: "land", polygons: polygon },
            { id: "water", role: "water", polygons: polygon },
            { id: "graticule", role: "graticule", lines: [[{ x: 0, y: 50 }, { x: 100, y: 50 }]] },
            { id: "coastline", role: "coastline", lines: [[{ x: 20, y: 20 }, { x: 80, y: 20 }]] },
            { id: "admin0", role: "admin0", lines: [[{ x: 50, y: 20 }, { x: 50, y: 80 }]] }
        ],
        labels: Array.from({ length: labels }, (_, index) => ({
            key: index === 0 ? "interactive" : `reference:${index}`,
            text: index === 0 ? "Focused place" : `Place ${index}`,
            anchor: { x: 50 + (index % 8) * 12, y: 50 + Math.floor(index / 8) * 14 },
            rank: index + 1,
            minZoom: index === 0 ? 99 : 1
        }))
    };
}

function contextScene(labels = 1): ContextScene {
    return {
        ...scene("test", "builtInPack", [{
            index: 0,
            key: "interactive",
            label: "Interactive",
            description: "Interactive analytical country",
            geometry: { kind: "polygon", polygons: polygon, center: { x: 50, y: 50 } }
        }]),
        cartography: cartography(labels)
    };
}

function request(value: ContextScene, showNoDataBackdrop = true): ContextRenderRequest {
    return {
        scene: value,
        sceneIdentity: "cartography-scene",
        paintIdentity: showNoDataBackdrop ? "all" : "hidden",
        viewport: { width: 240, height: 160 },
        baseTransform: { scale: 1, translateX: 0, translateY: 0, invertY: false },
        camera: { zoom: 1, panX: 0, panY: 0 },
        focusedFeatureKey: "interactive",
        selectedFeatureKeys: new Set(),
        showNoDataBackdrop,
        interactive: true,
        cartography: {
            detail: "full",
            showPhysicalLayers: true,
            showLabels: true,
            showGraticule: true,
            labelDensity: "detailed"
        },
        navigation: {
            enabled: true,
            showProbe: true,
            showResetControl: true,
            showGestureHelp: true,
            resetLabel: "Reset",
            probeDescription: "Probe",
            gestureHelp: "Help"
        }
    };
}

const style = {
    fill: "#d8d4c9",
    stroke: "#777",
    selected: "#08f",
    background: "#fff",
    pointSize: 6,
    ocean: "#dce8ec",
    land: "#f1efe8",
    water: "#c7dce3",
    river: "#7fa9b8",
    graticule: "#9aa",
    coastline: "#667",
    admin: "#999",
    mapLabel: "#222",
    mapLabelHalo: "#fff"
};

describe("noninteractive reference cartography", () => {
    it("provides subordinate light, dark, and host high-contrast palettes", () => {
        const light = resolveTheme(undefined, defaultSettings());
        const dark = resolveTheme({
            isHighContrast: false,
            background: { value: "#101820" }
        } as never, defaultSettings());
        const highContrast = resolveTheme({
            isHighContrast: true,
            foreground: { value: "#ffff00" },
            background: { value: "#000000" },
            foregroundSelected: { value: "#00ffff" }
        } as never, defaultSettings());
        expect(light.cartography).toMatchObject({
            ocean: "#DCE8EC",
            land: "#F1EFE8",
            label: "#303536"
        });
        expect(dark.isDark).toBe(true);
        expect(dark.cartography.label).toBe("#F3F6F7");
        expect(highContrast.cartography).toMatchObject({
            ocean: "#000000",
            land: "#000000",
            coastline: "#ffff00",
            label: "#ffff00",
            labelHalo: "#000000"
        });
        expect(highContrast.foregroundSelected).toBe("#00ffff");
    });

    it("keeps strict layer order and reference geometry outside picking and semantics", () => {
        const parent = document.createElement("div");
        const elements = createContextSurface(parent);
        const rendered = renderContextSurface(
            elements,
            request(contextScene()),
            "svg",
            style,
            1,
            createContextPerformanceMetrics()
        );
        const ordered = [...elements.svg.querySelectorAll(
            "[data-reference-role], [data-context-key]"
        )].map((entry) =>
            entry.getAttribute("data-reference-role") ?? `feature:${entry.getAttribute("data-context-key")}`);
        expect(ordered).toEqual([
            "sphere",
            "land",
            "water",
            "graticule",
            "feature:interactive",
            "coastline",
            "admin0"
        ]);
        expect(rendered.hitTest(10, 10)).toBeNull();
        expect(rendered.hitTest(50, 50)?.featureKey).toBe("interactive");
        expect(elements.semantic.querySelectorAll("[role='option']")).toHaveLength(1);
        expect(elements.semantic.querySelector("[data-reference-role]")).toBeNull();
    });

    it("retains reference paint when no-data analytical paint is hidden", () => {
        const parent = document.createElement("div");
        const elements = createContextSurface(parent);
        renderContextSurface(
            elements,
            request(contextScene(), false),
            "svg",
            style,
            1,
            createContextPerformanceMetrics()
        );
        expect(elements.svg.querySelector("[data-context-key='interactive']")
            ?.getAttribute("visibility")).toBe("hidden");
        expect(elements.svg.querySelector("[data-reference-role='land']")
            ?.getAttribute("visibility")).not.toBe("hidden");
    });

    it("bounds stable fixed-size labels and keeps the focused label eligible", () => {
        const parent = document.createElement("div");
        const elements = createContextSurface(parent);
        const metrics = createContextPerformanceMetrics();
        const rendered = renderContextSurface(
            elements,
            request(contextScene(80)),
            "svg",
            style,
            1,
            metrics
        );
        const focused = elements.svg.querySelector("[data-label-key='interactive']");
        expect(focused).not.toBeNull();
        expect(focused?.getAttribute("font-size")).toBe("11");
        expect(elements.svg.querySelectorAll(".profile-lens-context-map-label").length)
            .toBeLessThanOrEqual(40);
        const beforeBuilds = {
            reference: metrics.referenceGeometryBuilds,
            svg: metrics.svgGeometryBuilds
        };
        rendered.setCamera({ zoom: 2, panX: 5, panY: -3 });
        expect(elements.svg.querySelector("[data-label-key='interactive']")
            ?.getAttribute("font-size")).toBe("11");
        expect(metrics.referenceGeometryBuilds).toBe(beforeBuilds.reference);
        expect(metrics.svgGeometryBuilds).toBe(beforeBuilds.svg);
        expect(metrics.labelLayoutUpdates).toBeGreaterThan(1);
        expect(metrics.maxVisibleLabels).toBeLessThanOrEqual(40);
    });

    it("refreshes focused-label eligibility on dynamic focus changes", () => {
        const parent = document.createElement("div");
        const elements = createContextSurface(parent);
        const initial = { ...request(contextScene(4)), focusedFeatureKey: null };
        const rendered = renderContextSurface(
            elements,
            initial,
            "svg",
            style,
            1,
            createContextPerformanceMetrics()
        );
        expect(elements.svg.querySelector("[data-label-key='interactive']")).toBeNull();
        rendered.updateDynamic({ ...initial, focusedFeatureKey: "interactive" });
        expect(elements.svg.querySelector("[data-label-key='interactive']")).not.toBeNull();
    });
});
