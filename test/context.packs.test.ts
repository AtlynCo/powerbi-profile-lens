import { describe, expect, it } from "vitest";
import type { ContextProviderInput } from "../src/context/contract";
import type { EntityRef } from "../src/model/contract";
import { StaticContextPackProvider } from "../src/context/packs/provider";
import { ContextPackRegistry } from "../src/context/packs/registry";
import { projectContextPack, US_CONTEXT_INSETS } from "../src/context/packs/projection";
import { spatialNeighbor } from "../src/interaction/spatialNavigation";

function entity(index: number, value: EntityRef["value"], key = `entity:${index}`): EntityRef {
    return { index, key, label: String(value), value, identity: { index } };
}

function input(
    entities: readonly EntityRef[],
    id: string,
    keyMode: string
): ContextProviderInput {
    return {
        entities,
        entityIdentities: new Map(entities.map((entry) => [
            entry.index,
            { key: entry.key, hostIdentity: entry.identity }
        ])),
        contextValues: new Map(entities.map((entry) => [entry.index, entry.index + 10])),
        coordinates: [],
        geometryTexts: [],
        pack: { id, keyMode }
    };
}

describe("built-in context pack registry", () => {
    it("registers immutable manifests with exact source coverage", () => {
        const registry = new ContextPackRegistry();
        const manifests = registry.manifests();
        expect(manifests.map((entry) => entry.id)).toEqual([
            "world-countries-110m",
            "world-countries-50m",
            "us-states-2025-5m",
            "us-counties-2025-5m"
        ]);
        expect(manifests.map((entry) => entry.featureCount)).toEqual([177, 242, 56, 3235]);
        expect(manifests.every((entry) => entry.schemaVersion === 2)).toBe(true);
        for (const manifest of manifests.slice(0, 2)) {
            expect(Object.keys(manifest.layerCounts)).toEqual([
                "features",
                "sphere",
                "land",
                "water",
                "coastline",
                "admin0",
                "graticule"
            ]);
            expect(manifest.layerCounts).toMatchObject({
                sphere: 1,
                land: 1,
                coastline: 1,
                admin0: 1,
                graticule: 1
            });
            expect(manifest.layerCounts.water).toBeGreaterThan(0);
            expect(manifest.sourceArchives).toHaveLength(2);
            expect(manifest.sourceArchives.every((entry) =>
                entry.license === "Natural Earth public domain")).toBe(true);
        }
        const fallback = manifests[0].fallbackKeys;
        expect(fallback.length).toBeGreaterThan(0);
        expect(fallback).toEqual([...fallback].sort());
        expect(fallback.every((key) => /^NE:[A-Z0-9]{3}$/.test(key))).toBe(true);
    });

    it("projects every feature to finite generic scene geometry", () => {
        const registry = new ContextPackRegistry();
        for (const manifest of registry.manifests()) {
            const artifact = registry.resolve(manifest.id);
            expect(artifact).not.toBeNull();
            const projected = projectContextPack(artifact!);
            expect(projected.features).toHaveLength(manifest.featureCount);
            if (manifest.level === "country") {
                expect(projected.cartography?.layers.map((layer) => layer.role)).toEqual([
                    "sphere",
                    "land",
                    "water",
                    "graticule",
                    "coastline",
                    "admin0"
                ]);
                expect(projected.cartography?.labels).toHaveLength(manifest.featureCount);
                expect(new Set(projected.cartography?.labels.map((label) => label.key)).size)
                    .toBe(manifest.featureCount);
                for (const label of projected.cartography?.labels ?? []) {
                    expect(Number.isFinite(label.anchor.x)).toBe(true);
                    expect(Number.isFinite(label.anchor.y)).toBe(true);
                }
                const australia = projected.cartography?.labels.find(
                    (label) => label.key === "AUS"
                );
                expect(australia?.rank).toBeLessThanOrEqual(10);
                const norway = projected.cartography?.labels.find(
                    (label) => label.key === "NOR"
                );
                const norwayFeature = projected.features.find(
                    (entry) => entry.properties.canonicalKey === "NOR"
                );
                expect(Math.abs(norway!.anchor.x - norwayFeature!.geometry.center.x))
                    .toBeLessThan(100);
                expect(Math.abs(norway!.anchor.y - norwayFeature!.geometry.center.y))
                    .toBeLessThan(100);
            } else {
                const roles = projected.cartography?.layers.map((layer) => layer.role);
                expect(roles).toEqual(manifest.level === "county"
                    ? ["land", "admin2", "admin1", "coastline", "insetFrame"]
                    : ["land", "admin1", "coastline", "insetFrame"]);
                expect(projected.cartography?.labels).toHaveLength(
                    manifest.level === "county" ? manifest.featureCount + 63 : 63
                );
                expect(projected.cartography?.labels.filter((label) =>
                    label.role === "inset")).toHaveLength(7);
                expect(projected.cartography?.labels.filter((label) =>
                    label.role === "state")).toHaveLength(
                    manifest.level === "county" ? 56 : 0
                );
                const featureVertices = new Set(projected.features.flatMap((entry) =>
                    (entry.geometry.polygons ?? []).flatMap((polygon) =>
                        polygon.flatMap((ring) => ring.map((point) =>
                            `${point.x.toFixed(6)},${point.y.toFixed(6)}`)))));
                for (const layer of projected.cartography?.layers.filter((entry) =>
                    entry.role !== "insetFrame" && entry.role !== "land") ?? []) {
                    for (const point of layer.lines?.flat() ?? []) {
                        expect(featureVertices.has(
                            `${point.x.toFixed(6)},${point.y.toFixed(6)}`
                        )).toBe(true);
                    }
                }
            }
            for (const entry of projected.features) {
                expect(Number.isFinite(entry.geometry.center.x)).toBe(true);
                expect(Number.isFinite(entry.geometry.center.y)).toBe(true);
                const points = (entry.geometry.polygons ?? [])
                    .flatMap((polygon) => polygon.flatMap((ring) => ring));
                expect(points.length).toBeGreaterThan(0);
                expect(points.every((point) =>
                    Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
            }
        }
    });

    it("keeps every US feature inside one explicit non-overlapping region", () => {
        const boxes = Object.values(US_CONTEXT_INSETS);
        for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
                const left = boxes[leftIndex];
                const right = boxes[rightIndex];
                const separated = left[0] + left[2] <= right[0]
                    || right[0] + right[2] <= left[0]
                    || left[1] + left[3] <= right[1]
                    || right[1] + right[3] <= left[1];
                expect(separated).toBe(true);
            }
        }

        const registry = new ContextPackRegistry();
        for (const id of ["us-states-2025-5m", "us-counties-2025-5m"]) {
            const projected = projectContextPack(registry.resolve(id)!);
            for (const entry of projected.features) {
                const box = US_CONTEXT_INSETS[entry.properties.region];
                expect(box).toBeDefined();
                const points = entry.geometry.polygons!
                    .flatMap((polygon) => polygon.flatMap((ring) => ring));
                expect(points.every((point) =>
                    point.x >= box[0] - 0.001
                    && point.x <= box[0] + box[2] + 0.001
                    && point.y >= box[1] - 0.001
                    && point.y <= box[1] + box[3] + 0.001
                )).toBe(true);
            }
        }
    });
});

describe("built-in context pack joins", () => {
    it("keeps complete world, state, and county backdrop with partial report bindings", () => {
        const provider = new StaticContextPackProvider();
        for (const value of [
            ["world-countries-110m", "canonical", "USA", 177],
            ["world-countries-50m", "canonical", "USA", 242],
            ["us-states-2025-5m", "geoid2", "06", 56],
            ["us-counties-2025-5m", "geoid5", "06037", 3235]
        ] as const) {
            const result = provider.provide(
                "builtInPack",
                input([entity(0, value[2])], value[0], value[1])
            );
            expect(result.backdrop.features).toHaveLength(value[3]);
            expect(result.backdrop.featureByKey.size).toBe(value[3]);
            expect(result.entities.byFeatureKey.size).toBe(1);
            expect(result.entities.featureKeyByEntityKey.size).toBe(1);
            expect(result.cartography?.labels).toHaveLength(
                value[0].startsWith("world-")
                    ? value[3]
                    : value[0].startsWith("us-counties")
                        ? value[3] + 63
                        : 63
            );
            expect(result.cartography?.layers.every((layer) =>
                !("index" in layer)
                && !("selection" in layer)
                && !("tooltipValues" in layer))).toBe(true);
            expect(result.diagnostics).toEqual([]);

            const bindingFreeInput = input([], value[0], value[1]);
            expect(provider.canProvide("builtInPack", bindingFreeInput)).toBe(true);
            const bindingFree = provider.provide("builtInPack", bindingFreeInput);
            expect(bindingFree.backdrop.features).toHaveLength(value[3]);
            expect(bindingFree.entities.byFeatureKey.size).toBe(0);
            expect(bindingFree.diagnostics).toEqual([]);
        }
    });

    it("joins exact world ISO and generated fallback keys without changing entity identity", () => {
        const provider = new StaticContextPackProvider();
        const entities = [
            entity(0, "USA", "stable-us"),
            entity(1, "NE:KOS", "stable-kosovo"),
            entity(2, "FRA", "stable-france"),
            entity(3, "NOR", "stable-norway")
        ];
        const result = provider.provide(
            "builtInPack",
            input(entities, "world-countries-110m", "canonical")
        );
        expect(result.backdrop.features).toHaveLength(177);
        expect([...result.entities.byFeatureKey.values()].map((entry) => entry.entityKey)).toEqual([
            "stable-us",
            "stable-kosovo",
            "stable-france",
            "stable-norway"
        ]);
        expect([
            "USA",
            "NE:KOS",
            "FRA",
            "NOR"
        ].map((key) => result.backdrop.featureByKey.get(key)?.label)).toEqual([
            "United States of America",
            "Kosovo",
            "France",
            "Norway"
        ]);
        expect(result.entities.byFeatureKey.get("USA")?.selection?.hostIdentity)
            .toBe(entities[0].identity);
        expect(result.entities.byFeatureKey.get("USA")?.tooltipValues).toEqual([
            { displayName: "Context value", value: "10" }
        ]);
        expect(result.metadata).toMatchObject({
            vintage: "Natural Earth 5.1.1",
            policyId: "natural-earth-de-facto-v1"
        });
        const obsoleteFallbacks = provider.provide(
            "builtInPack",
            input(
                [entity(0, "NE:FRA"), entity(1, "NE:NOR")],
                "world-countries-110m",
                "canonical"
            )
        );
        expect(obsoleteFallbacks.backdrop.features).toHaveLength(177);
        expect(obsoleteFallbacks.entities.byFeatureKey.size).toBe(0);
        expect(obsoleteFallbacks.diagnostics[0]).toMatchObject({
            code: "unmatchedPackKey",
            rejected: 2
        });
    });

    it("only case-folds in the explicitly selected world mode and never trims", () => {
        const provider = new StaticContextPackProvider();
        const folded = provider.provide("builtInPack", input(
            [entity(0, "usa")],
            "world-countries-110m",
            "isoAlpha3CaseFold"
        ));
        expect(folded.entities.byFeatureKey.size).toBe(1);

        const exact = provider.provide("builtInPack", input(
            [entity(0, "usa"), entity(1, " USA"), entity(2, 6)],
            "world-countries-110m",
            "canonical"
        ));
        expect(exact.entities.byFeatureKey.size).toBe(0);
        expect(exact.diagnostics.find((entry) => entry.code === "malformedPackKey"))
            .toMatchObject({ rejected: 3 });
    });

    it("requires exact text Census GEOIDs and rejects ambiguous duplicates", () => {
        const provider = new StaticContextPackProvider();
        const states = provider.provide("builtInPack", input(
            [entity(0, "06"), entity(1, "60"), entity(2, 6)],
            "us-states-2025-5m",
            "geoid2"
        ));
        expect([...states.entities.byFeatureKey.keys()].map(
            (key) => states.backdrop.featureByKey.get(key)?.label
        )).toEqual([
            "California",
            "American Samoa"
        ]);
        expect(states.diagnostics.some((entry) => entry.code === "malformedPackKey")).toBe(true);

        const counties = provider.provide("builtInPack", input(
            [entity(0, "06037"), entity(1, "06037"), entity(2, "72001")],
            "us-counties-2025-5m",
            "geoid5"
        ));
        expect(counties.entities.byFeatureKey.size).toBe(1);
        expect(counties.backdrop.featureByKey.get("72001")?.label).toBe("Adjuntas");
        expect(counties.diagnostics.find((entry) => entry.code === "duplicatePackKey"))
            .toMatchObject({ rejected: 2 });
    });

    it("reports unsupported and unmatched keys with bounded examples", () => {
        const provider = new StaticContextPackProvider();
        const unsupported = provider.provide("builtInPack", input(
            [entity(0, "NE:KOS")],
            "world-countries-110m",
            "isoAlpha3CaseFold"
        ));
        expect(unsupported.diagnostics[0]).toMatchObject({ code: "unsupportedPackKey" });

        const unmatched = provider.provide("builtInPack", input(
            Array.from({ length: 8 }, (_, index) =>
                entity(index, `ZZ${String.fromCharCode(65 + index)}`)),
            "world-countries-110m",
            "canonical"
        ));
        const diagnostic = unmatched.diagnostics.find((entry) => entry.code === "unmatchedPackKey");
        expect(diagnostic?.detail?.split(", ")).toHaveLength(5);
    });

    it("uses precomputed adjacency before deterministic centroid fallback", () => {
        const provider = new StaticContextPackProvider();
        const result = provider.provide("builtInPack", input(
            [entity(0, "CAN", "ca"), entity(1, "USA", "us"), entity(2, "MEX", "mx")],
            "world-countries-110m",
            "canonical"
        ));
        const transform = { scale: 1, translateX: 0, translateY: 0, invertY: false };
        const current = result.backdrop.featureByKey.get("USA");
        expect(current?.navigationKeys).toContain("MEX");
        const next = spatialNeighbor(
            result.backdrop.features,
            "context:USA",
            "ArrowDown",
            transform,
            false
        );
        expect(next).not.toBeNull();
        expect(result.backdrop.features.some((entry) => entry.key === next?.key)).toBe(true);
    });
});
