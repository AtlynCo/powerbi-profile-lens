import { describe, expect, it } from "vitest";
import { ContextProviderRegistry, ContextRendererRegistry } from "../src/context/registry";
import { chooseContextRenderer } from "../src/context/rendererSelection";
import {
    decodeFeatureColor,
    encodeFeatureColor,
    hitTestBoundedCandidates,
    hitTestScene
} from "../src/context/hitTest";
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

    it("resolves adjacent, holed, overlapping, and shared-edge candidates with bounded parity", () => {
        const transform = { scale: 1, translateX: 0, translateY: 0, invertY: false };
        const polygon = (
            index: number,
            key: string,
            rings: readonly (readonly { x: number; y: number }[])[]
        ): ContextScene["features"][number] => ({
            index,
            key,
            entityIndex: index,
            label: key,
            description: key,
            selection: { key, hostIdentity: null },
            contextValue: null,
            tooltipValues: [],
            geometry: {
                kind: "polygon",
                center: rings[0][0],
                polygons: [[...rings]]
            }
        });
        const base = polygon(0, "base", [[
            { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
            { x: 0, y: 10 }, { x: 0, y: 0 }
        ]]);
        const adjacent = polygon(1, "adjacent", [[
            { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 },
            { x: 10, y: 10 }, { x: 10, y: 0 }
        ]]);
        const holed = polygon(2, "holed", [
            [
                { x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 },
                { x: 2, y: 8 }, { x: 2, y: 2 }
            ],
            [
                { x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 },
                { x: 4, y: 6 }, { x: 4, y: 4 }
            ]
        ]);
        const overlap = polygon(3, "overlap", [[
            { x: 7, y: 2 }, { x: 12, y: 2 }, { x: 12, y: 8 },
            { x: 7, y: 8 }, { x: 7, y: 2 }
        ]]);

        const adjacentFallback = hitTestBoundedCandidates(
            adjacent,
            [base, adjacent],
            transform,
            9.9,
            9
        );
        expect(adjacentFallback).toMatchObject({
            hit: { featureKey: "base" },
            candidateValidations: 2,
            localizedCandidateValidations: 2
        });

        const holeFallback = hitTestBoundedCandidates(
            holed,
            [base, holed],
            transform,
            5,
            5
        );
        expect(holeFallback.hit?.featureKey).toBe("base");

        const overlapHit = hitTestBoundedCandidates(
            overlap,
            [base, overlap],
            transform,
            8,
            5
        );
        expect(overlapHit).toMatchObject({
            hit: { featureKey: "overlap" },
            candidateValidations: 1,
            localizedCandidateValidations: 1
        });

        const sharedScene: ContextScene = {
            ...scene(2, 10),
            features: [base, adjacent]
        };
        const expected = hitTestScene(sharedScene, transform, 10, 9);
        const shared = hitTestBoundedCandidates(
            adjacent,
            sharedScene.features,
            transform,
            10,
            9
        );
        expect(shared.hit).toEqual(expected);
    });

    it("retains every localized candidate under the scene budget", () => {
        const transform = { scale: 1, translateX: 0, translateY: 0, invertY: false };
        const candidates = Array.from({ length: 40 }, (_, index) => ({
            index,
            key: `outside-${index}`,
            entityIndex: index,
            label: `outside-${index}`,
            description: `outside-${index}`,
            selection: { key: `outside-${index}`, hostIdentity: null },
            contextValue: null,
            tooltipValues: [],
            geometry: {
                kind: "polygon" as const,
                center: { x: 100 + index, y: 100 },
                polygons: [[[
                    { x: 100 + index, y: 100 },
                    { x: 101 + index, y: 100 },
                    { x: 101 + index, y: 101 },
                    { x: 100 + index, y: 101 },
                    { x: 100 + index, y: 100 }
                ]]]
            }
        }));
        const validBase = {
            ...candidates[0],
            key: "valid-base",
            geometry: {
                kind: "polygon" as const,
                center: { x: 0.5, y: 0.5 },
                polygons: [[[
                    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 },
                    { x: 0, y: 1 }, { x: 0, y: 0 }
                ]]]
            }
        };
        const result = hitTestBoundedCandidates(
            validBase,
            [validBase, ...candidates],
            transform,
            0.5,
            0.5
        );
        expect(result.hit?.featureKey).toBe("valid-base");
        expect(result.candidateValidations).toBe(41);
        expect(result.localizedCandidatesExamined).toBe(41);
    });

    it("keeps a valid picked feature below more than 32 later candidates", () => {
        const transform = { scale: 1, translateX: 0, translateY: 0, invertY: false };
        const base = {
            index: 0,
            key: "base",
            entityIndex: 0,
            label: "base",
            description: "base",
            selection: { key: "base", hostIdentity: null },
            contextValue: null,
            tooltipValues: [],
            geometry: {
                kind: "polygon" as const,
                center: { x: 5, y: 5 },
                polygons: [[[
                    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 },
                    { x: 0, y: 10 }, { x: 0, y: 0 }
                ]]]
            }
        };
        const later = Array.from({ length: 40 }, (_, index) => ({
            ...base,
            index: index + 1,
            key: `later-${index}`,
            geometry: {
                ...base.geometry,
                center: { x: 105 + index, y: 5 },
                polygons: [[[
                    { x: 100 + index, y: 0 }, { x: 101 + index, y: 0 },
                    { x: 101 + index, y: 10 }, { x: 100 + index, y: 10 },
                    { x: 100 + index, y: 0 }
                ]]]
            }
        }));
        const result = hitTestBoundedCandidates(
            base,
            [base, ...later],
            transform,
            5,
            5
        );
        expect(result.hit?.featureKey).toBe("base");
        expect(result.candidateValidations).toBe(41);
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
