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
    it("joins exact world ISO and generated fallback keys without changing entity identity", () => {
        const provider = new StaticContextPackProvider();
        const entities = [
            entity(0, "USA", "stable-us"),
            entity(1, "NE:KOS", "stable-kosovo")
        ];
        const result = provider.provide(
            "builtInPack",
            input(entities, "world-countries-110m", "canonical")
        );
        expect(result.features.map((entry) => entry.key)).toEqual(["stable-us", "stable-kosovo"]);
        expect(result.features.map((entry) => entry.label)).toEqual(["United States of America", "Kosovo"]);
        expect(result.features[0].selection.hostIdentity).toBe(entities[0].identity);
        expect(result.features[0].tooltipValues).toEqual([
            { displayName: "Context value", value: "10" }
        ]);
        expect(result.metadata).toMatchObject({
            vintage: "Natural Earth 5.1.1",
            policyId: "natural-earth-de-facto-v1"
        });
    });

    it("only case-folds in the explicitly selected world mode and never trims", () => {
        const provider = new StaticContextPackProvider();
        const folded = provider.provide("builtInPack", input(
            [entity(0, "usa")],
            "world-countries-110m",
            "isoAlpha3CaseFold"
        ));
        expect(folded.features).toHaveLength(1);

        const exact = provider.provide("builtInPack", input(
            [entity(0, "usa"), entity(1, " USA"), entity(2, 6)],
            "world-countries-110m",
            "canonical"
        ));
        expect(exact.features).toEqual([]);
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
        expect(states.features.map((entry) => entry.label)).toEqual([
            "California",
            "American Samoa"
        ]);
        expect(states.diagnostics.some((entry) => entry.code === "malformedPackKey")).toBe(true);

        const counties = provider.provide("builtInPack", input(
            [entity(0, "06037"), entity(1, "06037"), entity(2, "72001")],
            "us-counties-2025-5m",
            "geoid5"
        ));
        expect(counties.features).toHaveLength(1);
        expect(counties.features[0].label).toBe("Adjuntas");
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
        const current = result.features.find((entry) => entry.key === "us");
        expect(current?.navigationKeys).toContain("mx");
        const next = spatialNeighbor(result.features, "context:us", "ArrowDown", transform, false);
        expect(next).not.toBeNull();
        expect(result.features.some((entry) => entry.key === next?.key)).toBe(true);
    });
});
