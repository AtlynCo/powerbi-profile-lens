import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { GeometryCollection, Objects, Topology } from "topojson-specification";
import type { ContextCartography, ContextGeometry } from "../contract";

export type ContextPackLevel = "country" | "state" | "county";
export type ContextPackProjectionId = "naturalEarth1-v1" | "us-composite-v1";

export interface ContextPackKeyMode {
    readonly id: string;
    readonly displayName: string;
    readonly example: string;
}

export interface ContextPackManifest {
    readonly schemaVersion: 2;
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
    readonly sourceArchives: readonly {
        readonly id: string;
        readonly sha256: string;
        readonly bytes: number;
        readonly license: string;
        readonly retainedFields: readonly string[];
    }[];
    readonly artifactSha256: string;
    readonly fallbackKeys: readonly string[];
    readonly alternateIsoKeys: readonly string[];
    readonly layerCounts: Readonly<Record<string, number>>;
    readonly layerVertexCounts: Readonly<Record<string, number>>;
}

export interface ContextPackProperties {
    readonly canonicalKey: string;
    readonly sourceId: string;
    readonly name: string;
    readonly status: string;
    readonly stateCode?: string;
    readonly region: string;
    readonly fallback: boolean;
    readonly codeSource: "ISO_A3" | "ISO_A3_EH" | "ADM0_A3" | "GEOID";
    readonly centroid: readonly [number, number];
    readonly bounds: readonly [number, number, number, number];
    readonly neighbors: readonly string[];
    readonly labelAnchor?: readonly [number, number];
    readonly labelRank?: number;
}

export type ContextPackObjects = Objects<ContextPackProperties> & {
    readonly features: GeometryCollection<ContextPackProperties>;
    readonly sphere?: GeometryCollection<ContextReferenceProperties>;
    readonly land?: GeometryCollection<ContextReferenceProperties>;
    readonly water?: GeometryCollection<ContextReferenceProperties>;
    readonly coastline?: GeometryCollection<ContextReferenceProperties>;
    readonly admin0?: GeometryCollection<ContextReferenceProperties>;
    readonly admin1?: GeometryCollection<ContextReferenceProperties>;
    readonly admin2?: GeometryCollection<ContextReferenceProperties>;
    readonly graticule?: GeometryCollection<ContextReferenceProperties>;
};

export interface ContextReferenceProperties {
    readonly id: string;
    readonly region?: string;
    readonly minZoom?: number;
    readonly maxZoom?: number;
}

export interface ContextPackLabel {
    readonly key: string;
    readonly text: string;
    readonly anchor: readonly [number, number];
    readonly rank: number;
    readonly minZoom: number;
    readonly maxZoom?: number;
    readonly region?: string;
    readonly role?: "feature" | "state" | "inset";
}

export interface ContextPackInset {
    readonly id: string;
    readonly text: string;
    readonly bounds: readonly [number, number, number, number];
}

export interface ContextPackArtifact {
    readonly manifest: ContextPackManifest;
    readonly topology: Topology<ContextPackObjects>;
    readonly labels: readonly ContextPackLabel[];
    readonly insets?: readonly ContextPackInset[];
}

export interface ProjectedPackFeature {
    readonly properties: ContextPackProperties;
    readonly geometry: ContextGeometry;
}

export interface ProjectedContextPack {
    readonly manifest: ContextPackManifest;
    readonly features: readonly ProjectedPackFeature[];
    readonly cartography?: ContextCartography;
}

export type PackFeatureCollection = FeatureCollection<
    Polygon | MultiPolygon,
    ContextPackProperties
>;
