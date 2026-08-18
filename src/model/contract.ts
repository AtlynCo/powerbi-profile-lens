/**
 * Immutable contract shared by the parser, normalization, layout, rendering and host layers.
 *
 * Everything in this file is data-only: no host objects, no DOM, no side effects. The visual is
 * profile-only, so the geographic roles that the field wells expose are represented here as typed
 * extension payloads that carry validated author input forward without giving it an execution path.
 */

export type NormalizationMode =
    | "raw"
    | "shareOfProfile"
    | "shareWithinSeries"
    | "indexToMaximum"
    | "alreadyPercent";

export type PercentScale = "fraction" | "percent";

export type BlankPolicy = "missing" | "zero";

export type Arrangement = "auto" | "radial" | "stacked";

export type TextDirection = "auto" | "ltr" | "rtl";

export type TableVisibility = "screenReader" | "visible";

/**
 * Hard runtime bounds. Every bound is enforced with a visible diagnostic that reports the received
 * and retained counts; nothing is silently truncated.
 */
export const LIMITS = {
    maxProfiles: 6,
    maxSeries: 2,
    maxHierarchyDepth: 3,
    maxEntities: 1000,
    maxPeriods: 100,
    maxBands: 100,
    maxTooltipFields: 10,
    maxRetainedCells: 120000,
    maxSegmentRequests: 4,
    maxGeometryCharacters: 32000,
    minLatitude: -90,
    maxLatitude: 90,
    minLongitude: -180,
    maxLongitude: 180
} as const;

export interface EntityRef {
    readonly index: number;
    /** Stable key used for focus restoration and deterministic tie-breaking only. */
    readonly key: string;
    readonly label: string;
    /** Host selection identity for the entity level matrix node, when the host provided one. */
    readonly identity: unknown;
}

export interface PeriodRef {
    readonly index: number;
    readonly key: string;
    readonly label: string;
}

export interface BandRef {
    readonly index: number;
    readonly key: string;
    readonly label: string;
}

export interface SeriesRef {
    readonly index: number;
    readonly key: string;
    readonly label: string;
}

export interface ProfileRef {
    readonly index: number;
    readonly key: string;
    readonly label: string;
    readonly formatString: string | null;
}

export interface TooltipFieldRef {
    readonly index: number;
    readonly key: string;
    readonly label: string;
    readonly formatString: string | null;
}

/** Index used when the report bound no Period level or no Series field. */
export const IMPLICIT_INDEX = -1;

export interface CellAddress {
    readonly entityIndex: number;
    /** IMPLICIT_INDEX when the report bound Entity > Band only. */
    readonly periodIndex: number;
    readonly bandIndex: number;
    /** IMPLICIT_INDEX when the report bound no Series field. */
    readonly seriesIndex: number;
    readonly profileIndex: number;
}

export type CellState = "value" | "missing" | "nonNumeric" | "nonFinite";

export interface ProfileCell extends CellAddress {
    readonly value: number | null;
    readonly state: CellState;
    /** Highlight value when the host applied cross-highlighting, otherwise null. */
    readonly highlight: number | null;
    readonly hasHighlight: boolean;
}

export interface TooltipDatum {
    readonly fieldIndex: number;
    readonly label: string;
    readonly value: string;
}

export interface ContextValuePayload {
    readonly entityIndex: number;
    readonly value: number;
    readonly formatString: string | null;
    readonly origin: "entityNode" | "leafAggregate";
}

export interface CoordinatePayload {
    readonly entityIndex: number;
    readonly latitude: number;
    readonly longitude: number;
    readonly origin: "entityNode" | "leafAggregate";
}

export type GeometryFormatHint = "geoJsonCandidate" | "wktCandidate" | "unrecognized";

/**
 * Custom geometry is captured verbatim and measured, never parsed. The profile-only package has no
 * geometry consumer, so producing a structural payload here keeps the author's binding visible
 * without creating a dormant parsing or rendering path.
 */
export interface GeometryPayload {
    readonly entityIndex: number;
    readonly text: string;
    readonly characters: number;
    readonly formatHint: GeometryFormatHint;
    readonly withinCharacterLimit: boolean;
    readonly origin: "entityNode" | "leafAggregate";
}

export type ExtensionRole = "ContextValue" | "Latitude" | "Longitude" | "Geometry";

export interface ExtensionRejectionCounts {
    readonly nonFiniteContextValues: number;
    readonly invalidCoordinates: number;
    readonly conflictingCoordinates: number;
    readonly incompleteCoordinates: number;
    readonly oversizedGeometry: number;
    readonly emptyGeometry: number;
}

export interface ExtensionPayload {
    readonly boundRoles: readonly ExtensionRole[];
    readonly contextValues: readonly ContextValuePayload[];
    readonly coordinates: readonly CoordinatePayload[];
    readonly geometry: readonly GeometryPayload[];
    readonly rejected: ExtensionRejectionCounts;
}

export interface CellCounts {
    readonly received: number;
    readonly retained: number;
    readonly missing: number;
    readonly nonNumeric: number;
    readonly nonFinite: number;
    readonly duplicate: number;
    readonly overLimit: number;
}

export interface SegmentState {
    /** Number of host updates whose data view has been merged into the current model. */
    readonly requests: number;
    readonly maxRequests: number;
    readonly moreDataAvailable: boolean;
    readonly partial: boolean;
}

export interface HierarchyShape {
    readonly depth: number;
    readonly hasPeriodLevel: boolean;
    readonly entityLevelLabel: string;
    readonly periodLevelLabel: string | null;
    readonly bandLevelLabel: string | null;
}

export type AuthoringStage =
    | "empty"
    | "needsEntity"
    | "needsBand"
    | "needsProfile"
    | "ready";

export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticCode =
    | "needsEntity"
    | "needsBand"
    | "needsProfile"
    | "hierarchyDepthUnsupported"
    | "profilesOverLimit"
    | "seriesOverLimit"
    | "entitiesOverLimit"
    | "periodsOverLimit"
    | "bandsOverLimit"
    | "tooltipFieldsOverLimit"
    | "cellsOverLimit"
    | "duplicateCells"
    | "blankValues"
    | "nonNumericValues"
    | "nonFiniteValues"
    | "negativeProfileValues"
    | "zeroDenominator"
    | "partialData"
    | "segmentLimitReached"
    | "highlightActive"
    | "interactionsDisabled"
    | "extensionRolesProfileOnly"
    | "invalidCoordinates"
    | "conflictingCoordinates"
    | "incompleteCoordinates"
    | "oversizedGeometry"
    | "emptyGeometry"
    | "nonFiniteContextValue";

export interface Diagnostic {
    readonly code: DiagnosticCode;
    readonly severity: DiagnosticSeverity;
    /** Localization resource key. The renderer resolves it; the model never stores display text. */
    readonly messageKey: string;
    readonly received?: number;
    readonly retained?: number;
    readonly rejected?: number;
    readonly detail?: string;
}

export interface ProfileDataModel {
    readonly stage: AuthoringStage;
    readonly hierarchy: HierarchyShape;
    readonly entities: readonly EntityRef[];
    readonly periodsByEntity: ReadonlyMap<number, readonly PeriodRef[]>;
    readonly bands: readonly BandRef[];
    readonly series: readonly SeriesRef[];
    readonly profiles: readonly ProfileRef[];
    readonly cells: readonly ProfileCell[];
    readonly cellIndex: ReadonlyMap<string, ProfileCell>;
    /** Host selection identities for band level matrix nodes, keyed by entity|period|band. */
    readonly bandIdentities: ReadonlyMap<string, unknown>;
    readonly tooltipFields: readonly TooltipFieldRef[];
    readonly tooltipIndex: ReadonlyMap<string, readonly TooltipDatum[]>;
    readonly extension: ExtensionPayload;
    readonly counts: CellCounts;
    readonly segments: SegmentState;
    readonly hasAnyHighlight: boolean;
    readonly diagnostics: readonly Diagnostic[];
    /** Fingerprint of the data-bearing shape, used to decide whether a cached model is still valid. */
    readonly fingerprint: string;
}

export function bandIdentityKey(
    entityIndex: number,
    periodIndex: number,
    bandIndex: number
): string {
    return `${entityIndex}|${periodIndex}|${bandIndex}`;
}

export function cellKey(address: CellAddress): string {
    return `${address.entityIndex}|${address.periodIndex}|${address.bandIndex}|${address.seriesIndex}|${address.profileIndex}`;
}

export function tooltipKey(
    entityIndex: number,
    periodIndex: number,
    bandIndex: number,
    seriesIndex: number
): string {
    return `${entityIndex}|${periodIndex}|${bandIndex}|${seriesIndex}`;
}

export function isRenderable(model: ProfileDataModel): boolean {
    return model.stage === "ready"
        && model.entities.length > 0
        && model.bands.length > 0
        && model.profiles.length > 0;
}
