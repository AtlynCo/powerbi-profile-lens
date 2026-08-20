import {
    geoAlbers,
    geoMercator,
    geoNaturalEarth1
} from "d3-geo";
import type { GeoProjection } from "d3-geo";
import type {
    Feature,
    FeatureCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Polygon,
    Position
} from "geojson";
import { feature } from "topojson-client";
import type {
    ContextCartography,
    ContextGeometry,
    ContextMapLayer,
    ContextMapLayerRole,
    MultiPolygonCoordinates,
    PolygonCoordinates,
    ScenePoint
} from "../contract";
import type {
    ContextPackArtifact,
    ContextPackProperties,
    PackFeatureCollection,
    ProjectedContextPack
} from "./contract";

const WORLD_EXTENT: [[number, number], [number, number]] = [[0, 0], [1000, 640]];
export const US_CONTEXT_INSETS: Readonly<
    Record<string, readonly [number, number, number, number]>
> = {
    conus: [0, 0, 1000, 470],
    alaska: [0, 480, 220, 160],
    hawaii: [230, 480, 110, 75],
    puertoRico: [350, 480, 180, 75],
    usVirginIslands: [540, 480, 80, 75],
    americanSamoa: [630, 480, 100, 75],
    guam: [740, 480, 90, 75],
    northernMarianaIslands: [840, 480, 120, 75]
};

export function projectContextPack(artifact: ContextPackArtifact): ProjectedContextPack {
    const collection = feature(
        artifact.topology,
        artifact.topology.objects.features
    ) as PackFeatureCollection;
    const projections = artifact.manifest.projectionId === "naturalEarth1-v1"
        ? new Map([[
            "world",
            fitProjection(geoNaturalEarth1(), WORLD_EXTENT, collection.features)
        ]])
        : createUsProjections(collection);
    const projected = collection.features.map((entry) => {
        const projection = projections.get(entry.properties.region);
        if (!projection) {
            throw new Error(
                `Context pack ${artifact.manifest.id} has unknown region `
                + `"${entry.properties.region}".`
            );
        }
        return {
            properties: entry.properties,
            geometry: projectGeometry(entry, projection)
        };
    });
    if (projected.length !== artifact.manifest.featureCount) {
        throw new Error(`Context pack ${artifact.manifest.id} feature count is invalid.`);
    }
    const worldProjection = projections.get("world");
    const cartography = worldProjection
        ? projectCartography(artifact, worldProjection)
        : undefined;
    return { manifest: artifact.manifest, features: projected, cartography };
}

const REFERENCE_ROLES = [
    "sphere",
    "land",
    "water",
    "graticule",
    "coastline",
    "admin0"
] as const;

function projectCartography(
    artifact: ContextPackArtifact,
    projection: GeoProjection
): ContextCartography {
    const layers: ContextMapLayer[] = [];
    for (const role of REFERENCE_ROLES) {
        const object = artifact.topology.objects[role];
        if (!object) continue;
        const decoded = feature(artifact.topology, object) as unknown as FeatureCollection<
            Polygon | MultiPolygon | LineString | MultiLineString
        >;
        const polygons: PolygonCoordinates[] = [];
        const lines: ScenePoint[][] = [];
        for (const entry of decoded.features) {
            if (entry.geometry.type === "Polygon") {
                polygons.push(entry.geometry.coordinates.map((ring) => projectRing(ring, projection)));
            } else if (entry.geometry.type === "MultiPolygon") {
                polygons.push(...entry.geometry.coordinates.map((polygon) =>
                    polygon.map((ring) => projectRing(ring, projection))));
            } else if (entry.geometry.type === "LineString") {
                lines.push(projectRing(entry.geometry.coordinates, projection) as ScenePoint[]);
            } else {
                lines.push(...entry.geometry.coordinates.map((line) =>
                    projectRing(line, projection) as ScenePoint[]));
            }
        }
        layers.push({
            id: role,
            role: role as ContextMapLayerRole,
            polygons: polygons.length > 0 ? polygons : undefined,
            lines: lines.length > 0 ? lines : undefined
        });
    }
    const labels = artifact.labels.map((label) => ({
        ...label,
        anchor: projectPosition(label.anchor, projection)
    }));
    return { layers, labels };
}

function createUsProjections(
    collection: PackFeatureCollection
): ReadonlyMap<string, GeoProjection> {
    const projections = new Map<string, GeoProjection>();
    for (const [region, box] of Object.entries(US_CONTEXT_INSETS)) {
        const features = collection.features.filter((entry) => entry.properties.region === region);
        if (features.length === 0) {
            throw new Error(`US context pack is missing the ${region} region.`);
        }
        const extent: [[number, number], [number, number]] = [
            [box[0] + 4, box[1] + 4],
            [box[0] + box[2] - 4, box[1] + box[3] - 4]
        ];
        if (region === "conus") {
            projections.set(region, fitProjection(geoAlbers(), extent, features));
            continue;
        }
        const center = averageCenter(features);
        projections.set(
            region,
            fitProjection(
                geoMercator().rotate([-center[0], 0]),
                extent,
                features
            )
        );
    }
    return projections;
}

function averageCenter(
    features: readonly Feature<Polygon | MultiPolygon, ContextPackProperties>[]
): readonly [number, number] {
    const longitude = features.reduce(
        (sum, entry) => sum + entry.properties.centroid[0],
        0
    ) / features.length;
    const latitude = features.reduce(
        (sum, entry) => sum + entry.properties.centroid[1],
        0
    ) / features.length;
    return [longitude, latitude];
}

function fitProjection(
    projection: GeoProjection,
    extent: [[number, number], [number, number]],
    features: readonly Feature<Polygon | MultiPolygon, ContextPackProperties>[]
): GeoProjection {
    projection.scale(1).translate([0, 0]);
    const points = features.flatMap((entry) => geometryPositions(entry.geometry));
    const projected = points.map((position) => projection(position)).filter(
        (position): position is [number, number] =>
            position !== null && Number.isFinite(position[0]) && Number.isFinite(position[1])
    );
    if (projected.length !== points.length || projected.length === 0) {
        throw new Error("Context pack projection could not fit every source coordinate.");
    }
    const xs = projected.map((position) => position[0]);
    const ys = projected.map((position) => position[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = extent[1][0] - extent[0][0];
    const height = extent[1][1] - extent[0][1];
    const spanX = Math.max(maxX - minX, Number.EPSILON);
    const spanY = Math.max(maxY - minY, Number.EPSILON);
    const scale = Math.min(width / spanX, height / spanY);
    return projection.scale(scale).translate([
        extent[0][0] + (width - spanX * scale) / 2 - minX * scale,
        extent[0][1] + (height - spanY * scale) / 2 - minY * scale
    ]);
}

function geometryPositions(geometry: Polygon | MultiPolygon): [number, number][] {
    const positions: [number, number][] = [];
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
        for (const ring of polygon) {
            for (const position of ring) {
                positions.push([position[0], position[1]]);
            }
        }
    }
    return positions;
}

function projectGeometry(
    entry: Feature<Polygon | MultiPolygon, ContextPackProperties>,
    projection: GeoProjection
): ContextGeometry {
    const polygons: MultiPolygonCoordinates = entry.geometry.type === "Polygon"
        ? [entry.geometry.coordinates.map((ring) => projectRing(ring, projection))]
        : entry.geometry.coordinates.map((polygon) =>
            polygon.map((ring) => projectRing(ring, projection)));
    const center = projectPosition(entry.properties.centroid, projection);
    return {
        kind: entry.geometry.type === "Polygon" ? "polygon" : "multiPolygon",
        polygons,
        center
    };
}

function projectRing(ring: readonly Position[], projection: GeoProjection): readonly ScenePoint[] {
    return ring.map((position) => projectPosition(position, projection));
}

function projectPosition(position: readonly number[], projection: GeoProjection): ScenePoint {
    const longitude = Math.min(Math.max(position[0], -180), 180);
    const latitude = Math.min(Math.max(position[1], -90), 90);
    const projected = projection([longitude, latitude]);
    if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) {
        throw new Error(
            `Context pack projection produced a non-finite point for `
            + `${String(position[0])},${String(position[1])}.`
        );
    }
    return { x: projected[0], y: projected[1] };
}
