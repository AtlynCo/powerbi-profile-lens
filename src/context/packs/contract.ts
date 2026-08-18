import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { GeometryCollection, Objects, Topology } from "topojson-specification";
import type { ContextGeometry } from "../contract";

export type ContextPackLevel = "country" | "state" | "county";
export type ContextPackProjectionId = "naturalEarth1-v1" | "us-composite-v1";

export interface ContextPackKeyMode {
    readonly id: string;
    readonly displayName: string;
    readonly example: string;
}

export interface ContextPackManifest {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly displayName: string;
    readonly level: ContextPackLevel;
    readonly vintage: string;
    readonly detail: string;
    readonly projectionId: ContextPackProjectionId;
    readonly keyModes: readonly ContextPackKeyMode[];
    readonly featureCount: number;
    readonly sourceName: string;
    readonly sourceLicense: string;
    readonly attribution: string;
    readonly policyId: string;
    readonly sourceArchiveSha256: string;
    readonly artifactSha256: string;
    readonly fallbackKeys: readonly string[];
}

export interface ContextPackProperties {
    readonly canonicalKey: string;
    readonly sourceId: string;
    readonly name: string;
    readonly status: string;
    readonly stateCode?: string;
    readonly region: string;
    readonly fallback: boolean;
    readonly centroid: readonly [number, number];
    readonly bounds: readonly [number, number, number, number];
    readonly neighbors: readonly string[];
}

export type ContextPackObjects = Objects<ContextPackProperties> & {
    readonly features: GeometryCollection<ContextPackProperties>;
};

export interface ContextPackArtifact {
    readonly manifest: ContextPackManifest;
    readonly topology: Topology<ContextPackObjects>;
}

export interface ProjectedPackFeature {
    readonly properties: ContextPackProperties;
    readonly geometry: ContextGeometry;
}

export interface ProjectedContextPack {
    readonly manifest: ContextPackManifest;
    readonly features: readonly ProjectedPackFeature[];
}

export type PackFeatureCollection = FeatureCollection<
    Polygon | MultiPolygon,
    ContextPackProperties
>;
