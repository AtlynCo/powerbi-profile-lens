import { describe, expect, it } from "vitest";
import { ContextProviderRegistry, ContextRendererRegistry } from "../src/context/registry";
import { chooseContextRenderer } from "../src/context/rendererSelection";
import { decodeFeatureColor, encodeFeatureColor, hitTestScene } from "../src/context/hitTest";
import type {
    ContextProvider,
    ContextProviderInput,
    ContextRenderer,
    ContextScene
} from "../src/context/contract";
import { computeContextLayout } from "../src/layout/contextLayout";
import { canvasAllocation, pickingAllocation } from "../src/render/contextSurface";
import { createDefaultContextRenderers } from "../src/context/renderers";
import { fitScene, projectPoint } from "../src/context/projection";
import {
    AutoDetailStrategy,
    EagerDetailStrategy,
    ExternalDetailStrategy,
    MatrixExpandDetailStrategy,
    SegmentedDetailStrategy
} from "../src/detail/strategies";
import { parseMatrix } from "../src/model/parseMatrix";
import { buildMatrixDataView } from "./helpers/mockDataView";

const input: ContextProviderInput = {
    entities: [],
    entityIdentities: new Map(),
    contextValues: new Map(),
    coordinates: [],
    geometryTexts: []
};

function scene(featureCount: number, vertexCount: number): ContextScene {
    return {
        providerId: "test",
        mode: "grid",
        features: [],
        metrics: { featureCount, ringCount: 0, vertexCount },
        diagnostics: [],
        partial: false
    };
}

describe("context registries", () => {
    it("resolves providers deterministically and rejects duplicate IDs", () => {
        const registry = new ContextProviderRegistry();
        const provider: ContextProvider = {
            id: "test",
            modes: ["none"],
            canProvide: () => true,
            provide: () => scene(0, 0)
        };
        registry.register(provider);
        expect(registry.resolve("none", input)).toBe(provider);
        expect(() => registry.register(provider)).toThrow(/already registered/);
    });

    it("requires one renderer per backend", () => {
        const registry = new ContextRendererRegistry();
        const renderer: ContextRenderer = {
            id: "svg-test",
            kind: "svg",
            render: () => ({ kind: "svg", hitTest: () => null })
        };
        registry.register(renderer);
        expect(registry.resolve("svg")).toBe(renderer);
        expect(() => registry.register(renderer)).toThrow(/already registered/);
        expect(() => registry.resolve("canvas")).toThrow(/not registered/);
    });

    it("registers both built-in implementation backends", () => {
        const registry = new ContextRendererRegistry();
        for (const renderer of createDefaultContextRenderers()) {
            registry.register(renderer);
        }
        expect(registry.resolve("svg").id).toBe("svg-context");
        expect(registry.resolve("canvas").id).toBe("canvas-context");
    });
});

describe("adaptive renderer and layout", () => {
    it("selects Canvas when either measured threshold is exceeded", () => {
        expect(chooseContextRenderer(scene(500, 20_000))).toBe("svg");
        expect(chooseContextRenderer(scene(501, 20_000))).toBe("canvas");
        expect(chooseContextRenderer(scene(500, 20_001))).toBe("canvas");
    });

    it("caps Canvas DPR, dimensions, and backing pixels", () => {
        const allocation = canvasAllocation(8_000, 8_000, 4);
        expect(allocation.width).toBeLessThanOrEqual(4096);
        expect(allocation.height).toBeLessThanOrEqual(4096);
        expect(allocation.width * allocation.height).toBeLessThanOrEqual(8_388_608);
        expect(allocation.dpr).toBeLessThanOrEqual(2);
        const picking = pickingAllocation(10_000, 8_000);
        expect(picking.width).toBeLessThanOrEqual(4096);
        expect(picking.height).toBeLessThanOrEqual(4096);
        expect(picking.width * picking.height).toBeLessThanOrEqual(8_388_608);
        expect(picking.scaleX).toBeLessThan(1);
        expect(picking.scaleY).toBeLessThan(1);
    });

    it("degrades through profile only and mirrors split in RTL", () => {
        expect(computeContextLayout({ width: 80, height: 80 }, "focusLens", true, false).effectiveMode)
            .toBe("profileOnly");
        const ltr = computeContextLayout({ width: 800, height: 500 }, "split", true, false);
        const rtl = computeContextLayout({ width: 800, height: 500 }, "split", true, true);
        expect(ltr.context?.x).toBe(0);
        expect(rtl.context?.x).toBeGreaterThan(0);
        expect(rtl.profile.x).toBe(0);
    });

    it("projects northern WGS84 coordinates above southern coordinates", () => {
        const geographic: ContextScene = {
            ...scene(2, 2),
            mode: "points",
            features: [
                {
                    index: 0,
                    key: "north",
                    entityIndex: 0,
                    label: "North",
                    description: "North, point",
                    selection: { key: "north", hostIdentity: null },
                    contextValue: null,
                    tooltipValues: [],
                    geometry: {
                        kind: "point",
                        points: [{ x: 0, y: 60 }],
                        center: { x: 0, y: 60 }
                    }
                },
                {
                    index: 1,
                    key: "south",
                    entityIndex: 1,
                    label: "South",
                    description: "South, point",
                    selection: { key: "south", hostIdentity: null },
                    contextValue: null,
                    tooltipValues: [],
                    geometry: {
                        kind: "point",
                        points: [{ x: 0, y: -30 }],
                        center: { x: 0, y: -30 }
                    }
                }
            ]
        };
        const transform = fitScene(geographic, { width: 200, height: 200 });
        expect(projectPoint({ x: 0, y: 60 }, transform).y)
            .toBeLessThan(projectPoint({ x: 0, y: -30 }, transform).y);
    });
});

describe("hit testing", () => {
    it("round trips picking colors and physically hits a polygon", () => {
        const color = encodeFeatureColor(65_535);
        expect(decodeFeatureColor(...color)).toBe(65_535);
        const polygonScene: ContextScene = {
            ...scene(1, 5),
            features: [{
                index: 0,
                key: "a",
                entityIndex: 0,
                label: "A",
                description: "A grid cell",
                selection: { key: "a", hostIdentity: null },
                contextValue: null,
                tooltipValues: [],
                geometry: {
                    kind: "grid",
                    center: { x: 5, y: 5 },
                    polygons: [[[
                        { x: 0, y: 0 },
                        { x: 10, y: 0 },
                        { x: 10, y: 10 },
                        { x: 0, y: 10 },
                        { x: 0, y: 0 }
                    ]]]
                }
            }]
        };
        expect(hitTestScene(
            polygonScene,
            { scale: 1, translateX: 0, translateY: 0, invertY: false },
            5,
            5
        )?.featureKey).toBe("a");
        expect(hitTestScene(
            polygonScene,
            { scale: 1, translateX: 0, translateY: 0, invertY: false },
            15,
            15
        )).toBeNull();
    });
});

describe("detail strategies", () => {
    const dataView = buildMatrixDataView({
        entities: ["A"],
        bands: ["B"],
        profiles: ["M"]
    });
    const model = parseMatrix(dataView);
    const observation = { model, dataView, operationKind: undefined };

    it("keeps host expansion unavailable without native proof", () => {
        expect(new MatrixExpandDetailStrategy().evaluate().state).toBe("unavailable");
        expect(new EagerDetailStrategy().evaluate().requestMore).toBe(false);
        expect(new ExternalDetailStrategy().evaluate().requestMore).toBe(false);
    });

    it("auto selects bounded segmentation only when the host marks a segment", () => {
        expect(new AutoDetailStrategy().evaluate(observation).strategyId).toBe("eager");
        const segmentedView = buildMatrixDataView({
            entities: ["A"],
            bands: ["B"],
            profiles: ["M"],
            segment: true
        });
        const segmented = {
            model: parseMatrix(segmentedView),
            dataView: segmentedView,
            operationKind: undefined
        };
        expect(new AutoDetailStrategy().evaluate(segmented).strategyId).toBe("segmented");
        expect(new SegmentedDetailStrategy().evaluate(segmented).requestMore).toBe(true);
    });
});
