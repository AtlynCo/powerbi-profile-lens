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

export interface ContextTooltipValue {
    readonly displayName: string;
    readonly value: string;
}

/**
 * One provider-canonical backdrop geometry record.
 *
 * Report Entity data lives in ContextEntityBinding so complete cartography can remain stable when
 * the DataView contains only a subset of the visible features.
 */
export interface ContextFeature {
    readonly index: number;
    readonly key: string;
    readonly label: string;
    readonly description: string;
    readonly geometry: ContextGeometry;
    /** Provider-canonical keys of topologically adjacent features, when supplied. */
    readonly navigationKeys?: readonly string[];
    readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface ContextEntityBinding {
    readonly featureKey: string;
    readonly entityIndex: number;
    readonly entityKey: string;
    readonly entityLabel: string;
    readonly selection: ContextSelectionIdentity | null;
    readonly contextValue: number | null;
    readonly tooltipValues: readonly ContextTooltipValue[];
}

export interface ContextSceneMetrics {
    readonly featureCount: number;
    readonly ringCount: number;
    readonly vertexCount: number;
}

export interface ContextBackdrop {
    readonly features: readonly ContextFeature[];
    readonly featureByKey: ReadonlyMap<string, ContextFeature>;
    readonly metrics: ContextSceneMetrics;
}

export interface ContextEntityMappings {
    readonly byFeatureKey: ReadonlyMap<string, ContextEntityBinding>;
    readonly featureKeyByEntityKey: ReadonlyMap<string, string>;
}

export interface ContextSceneMetadata {
    readonly displayName: string;
    readonly vintage: string;
    readonly attribution: string;
    readonly policyId: string;
}

export interface ContextScene {
    readonly providerId: string;
    readonly mode: ContextMode;
    readonly backdrop: ContextBackdrop;
    readonly entities: ContextEntityMappings;
    readonly diagnostics: readonly Diagnostic[];
    readonly partial: boolean;
    readonly metadata?: ContextSceneMetadata;
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
    readonly paintIdentity: string;
    readonly viewport: Viewport;
    readonly baseTransform: SceneTransform;
    readonly camera: ContextCamera;
    readonly focusedFeatureKey: string | null;
    readonly selectedFeatureKeys: ReadonlySet<string>;
    readonly featureDescriptions?: ReadonlyMap<string, string>;
    readonly showNoDataBackdrop: boolean;
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
