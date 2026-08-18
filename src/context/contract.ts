import type { Diagnostic, EntityRef } from "../model/contract";
import type { ContextCamera } from "./viewport/contract";

export type ContextMode = "none" | "points" | "boundGeometry" | "grid" | "hex" | "builtInPack";
export type ContextRendererKind = "svg" | "canvas";
export type ContextGeometryKind = "point" | "multiPoint" | "polygon" | "multiPolygon" | "grid" | "hex";

export interface ScenePoint {
    readonly x: number;
    readonly y: number;
}

export type LinearRing = readonly ScenePoint[];
export type PolygonCoordinates = readonly LinearRing[];
export type MultiPolygonCoordinates = readonly PolygonCoordinates[];

export interface ContextGeometry {
    readonly kind: ContextGeometryKind;
    readonly points?: readonly ScenePoint[];
    readonly polygons?: MultiPolygonCoordinates;
    readonly center: ScenePoint;
}

export interface ContextSelectionIdentity {
    readonly key: string;
    readonly hostIdentity: unknown;
}

export interface ContextFeature {
    readonly index: number;
    readonly key: string;
    readonly entityIndex: number;
    readonly label: string;
    readonly description: string;
    readonly geometry: ContextGeometry;
    readonly selection: ContextSelectionIdentity;
    readonly contextValue: number | null;
    readonly tooltipValues: readonly { readonly displayName: string; readonly value: string }[];
    /** Stable entity keys of topologically adjacent features, when a provider supplies them. */
    readonly navigationKeys?: readonly string[];
}

export interface ContextSceneMetrics {
    readonly featureCount: number;
    readonly ringCount: number;
    readonly vertexCount: number;
}

export interface ContextScene {
    readonly providerId: string;
    readonly mode: ContextMode;
    readonly features: readonly ContextFeature[];
    readonly metrics: ContextSceneMetrics;
    readonly diagnostics: readonly Diagnostic[];
    readonly partial: boolean;
    readonly metadata?: {
        readonly displayName: string;
        readonly vintage: string;
        readonly attribution: string;
        readonly policyId: string;
    };
}

export interface ContextProviderInput {
    readonly entities: readonly EntityRef[];
    readonly entityIdentities: ReadonlyMap<number, ContextSelectionIdentity>;
    readonly contextValues: ReadonlyMap<number, number>;
    readonly coordinates: readonly {
        readonly entityIndex: number;
        readonly latitude: number;
        readonly longitude: number;
    }[];
    readonly geometryTexts: readonly {
        readonly entityIndex: number;
        readonly text: string;
        readonly characters: number;
        readonly withinCharacterLimit: boolean;
    }[];
    readonly authorLimits?: {
        readonly maxGeometryCharacters: number;
        readonly maxSceneVertices: number;
    };
    readonly pack?: {
        readonly id: string;
        readonly keyMode: string;
    };
}

export interface ContextProvider {
    readonly id: string;
    readonly modes: readonly ContextMode[];
    canProvide(mode: ContextMode, input: ContextProviderInput): boolean;
    provide(mode: ContextMode, input: ContextProviderInput): ContextScene;
}

export interface Viewport {
    readonly width: number;
    readonly height: number;
}

export interface SceneTransform {
    readonly scale: number;
    readonly translateX: number;
    readonly translateY: number;
    readonly invertY: boolean;
}

export interface ContextRenderRequest {
    readonly scene: ContextScene;
    readonly sceneIdentity: string;
    readonly viewport: Viewport;
    readonly baseTransform: SceneTransform;
    readonly camera: ContextCamera;
    readonly focusedKey: string | null;
    readonly selectedKeys: ReadonlySet<string>;
    readonly interactive: boolean;
    readonly navigation: {
        readonly enabled: boolean;
        readonly showProbe: boolean;
        readonly showResetControl: boolean;
        readonly showGestureHelp: boolean;
        readonly resetLabel: string;
        readonly probeDescription: string;
        readonly gestureHelp: string;
    };
    readonly connectorTarget?: ScenePoint;
    readonly pointSize?: number;
}

export interface ContextHit {
    readonly featureIndex: number;
    readonly featureKey: string;
}

export interface ContextRendererResult {
    readonly kind: ContextRendererKind;
    readonly hitTest: (x: number, y: number) => ContextHit | null;
}

export interface ContextRenderer {
    readonly id: string;
    readonly kind: ContextRendererKind;
    render(request: ContextRenderRequest): ContextRendererResult;
}
