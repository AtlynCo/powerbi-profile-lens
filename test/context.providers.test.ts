import { describe, expect, it } from "vitest";
import type { ContextProviderInput } from "../src/context/contract";
import type { EntityRef } from "../src/model/contract";
import {
    BoundGeometryContextProvider,
    NoneContextProvider,
    OddRHexContextProvider,
    RectangularGridContextProvider,
    Wgs84PointContextProvider,
    safeRawExcerpt
} from "../src/context/providers";
import { parseStrictGeometry } from "../src/context/geometry";

function entity(index: number, key = `key-${index}`): EntityRef {
    return { index, key, label: `Entity ${index}`, value: key, identity: { index } };
}

function input(
    entities: readonly EntityRef[],
    geometries: ContextProviderInput["geometryTexts"] = []
): ContextProviderInput {
    return {
        entities,
        entityIdentities: new Map(entities.map(value => [
            value.index,
            { key: value.key, hostIdentity: value.identity }
        ])),
        contextValues: new Map(entities.map(value => [value.index, value.index + 0.5])),
        coordinates: entities.map(value => ({
            entityIndex: value.index,
            latitude: 10 + value.index,
            longitude: 20 + value.index
        })),
        geometryTexts: geometries
    };
}

function geometry(entityIndex: number, text: string, overrides = {}): ContextProviderInput["geometryTexts"][number] {
    return {
        entityIndex,
        text,
        characters: text.length,
        withinCharacterLimit: true,
        ...overrides
    };
}

describe("pure context providers", () => {
    it("creates empty none and host-ordered WGS84 point scenes", () => {
        const entities = [entity(2), entity(0)];
        const value = input(entities);
        expect(new NoneContextProvider().provide("none", value)).toMatchObject({
            mode: "none",
            features: [],
            metrics: { featureCount: 0, ringCount: 0, vertexCount: 0 },
            partial: false
        });

        const points = new Wgs84PointContextProvider().provide("points", value);
        expect(points.features.map(feature => feature.entityIndex)).toEqual([2, 0]);
        expect(points.features[0]).toMatchObject({
            contextValue: 2.5,
            selection: { key: "key-2", hostIdentity: entities[0].identity },
            geometry: { kind: "point", center: { x: 22, y: 12 } }
        });
        expect(points.features[0].description).toContain("context value 2.5");
    });

    it.each([
        new RectangularGridContextProvider(),
        new OddRHexContextProvider()
    ])("$id keys placement by stable key but preserves host order", provider => {
        const first = [entity(7, "charlie"), entity(3, "alpha"), entity(9, "bravo")];
        const second = [first[2], first[0], first[1]];
        const mode = provider.modes[0];
        const sceneA = provider.provide(mode, input(first));
        const sceneB = provider.provide(mode, input(second));
        const centersA = new Map(sceneA.features.map(feature => [feature.key, feature.geometry.center]));
        const centersB = new Map(sceneB.features.map(feature => [feature.key, feature.geometry.center]));
        expect(centersA).toEqual(centersB);
        expect(sceneA.features.map(feature => feature.key)).toEqual(first.map(value => value.key));
        expect(sceneB.features.map(feature => feature.key)).toEqual(second.map(value => value.key));
        expect(sceneA.metrics.ringCount).toBe(3);
    });
});

describe("strict bound geometry", () => {
    it.each([
        ["GeoJSON Point", `{"type":"Point","coordinates":[1,2]}`, "point"],
        ["GeoJSON Feature", `{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,0]]]}}`, "polygon"],
        ["WKT MultiPoint", "MULTIPOINT ((1 2),(3 4))", "multiPoint"],
        ["WKT MultiPolygon", "SRID=4326;MULTIPOLYGON (((0 0,2 0,2 2,0 0)))", "multiPolygon"]
    ])("accepts strict %s", (_name, text, kind) => {
        expect(parseStrictGeometry(text).kind).toBe(kind);
    });

    it.each([
        ["FeatureCollection", `{"type":"FeatureCollection","features":[]}`],
        ["GeometryCollection", `{"type":"GeometryCollection","geometries":[]}`],
        ["GeoJSON line", `{"type":"LineString","coordinates":[[0,0],[1,1]]}`],
        ["unsafe key", `{"type":"Feature","properties":{"__proto__":true},"geometry":{"type":"Point","coordinates":[1,2]}}`],
        ["unknown CRS", `{"type":"Point","crs":{"type":"name","properties":{"name":"EPSG:3857"}},"coordinates":[1,2]}`],
        ["three dimensions", `{"type":"Point","coordinates":[1,2,3]}`],
        ["nonfinite", `{"type":"Point","coordinates":[1e400,2]}`],
        ["out of bounds", `{"type":"Point","coordinates":[181,2]}`],
        ["unclosed ring", "POLYGON ((0 0,2 0,2 2,1 1))"],
        ["undersized ring", "POLYGON ((0 0,1 0,0 0))"],
        ["trailing WKT", "POINT (1 2) nope"],
        ["malformed WKT", "POINT (1, 2)"],
        ["WKT three dimensions", "POINT (1 2 3)"],
        ["WKT line", "LINESTRING (0 0,1 1)"],
        ["non-WGS84 SRID", "SRID=3857;POINT (1 2)"]
    ])("rejects %s", (_name, text) => {
        expect(() => parseStrictGeometry(text)).toThrow();
    });

    it("enforces nesting, ring, vertex, and token limits", () => {
        const nested = `{"type":"Point","coordinates":${"[".repeat(13)}1${"]".repeat(13)}}`;
        expect(() => parseStrictGeometry(nested)).toThrow(/nesting/);

        const rings = Array.from({ length: 257 }, () => [[0, 0], [1, 0], [1, 1], [0, 0]]);
        expect(() => parseStrictGeometry(JSON.stringify({ type: "Polygon", coordinates: rings })))
            .toThrow(/ring limit/);

        const manyPoints = Array.from({ length: 4097 }, (_, index) => [index % 180, 0]);
        expect(() => parseStrictGeometry(JSON.stringify({ type: "MultiPoint", coordinates: manyPoints })))
            .toThrow(/vertex limit/);

        const tokenHeavy = `MULTIPOINT (${Array.from({ length: 5500 }, () => "0 0").join(",")})`;
        expect(() => parseStrictGeometry(tokenHeavy)).toThrow(/token limit/);
    });

    it("reports grouped rejection counts, safe capped examples, and partial metrics", () => {
        const entities = [entity(0), entity(1), entity(2)];
        const valid = "POLYGON ((0 0,2 0,2 2,0 0))";
        const scene = new BoundGeometryContextProvider().provide("boundGeometry", input(entities, [
            geometry(0, valid),
            geometry(1, "POINT (1 2) trailing\u0001"),
            geometry(2, "POINT (1 2) also-trailing")
        ]));
        expect(scene.features).toHaveLength(1);
        expect(scene.metrics).toEqual({ featureCount: 1, ringCount: 1, vertexCount: 4 });
        expect(scene.partial).toBe(true);
        expect(scene.diagnostics.find(value => value.code === "geometryParseRejected"))
            .toMatchObject({ received: 3, retained: 1, rejected: 2 });
        expect(scene.diagnostics.map(value => value.detail ?? "").join()).not.toContain("\u0001");
        expect(safeRawExcerpt(`${"x".repeat(200)}\u0002`)).toHaveLength(160);
    });

    it("enforces per-value and cumulative character budgets", () => {
        const entities = Array.from({ length: 63 }, (_, index) => entity(index));
        const text = `POINT (1 2)${" ".repeat(31989)}`;
        const values = entities.map(value => geometry(value.index, text));
        values[0] = geometry(0, "POINT (1 2)", { characters: 32001 });
        const scene = new BoundGeometryContextProvider().provide("boundGeometry", input(entities, values));
        expect(scene.diagnostics.some(value => value.code === "oversizedGeometry")).toBe(true);
        expect(scene.diagnostics.some(value => value.code === "geometryUpdateBudgetExceeded")).toBe(true);
    });
});
