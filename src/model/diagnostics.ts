import type { Diagnostic, DiagnosticCode, DiagnosticSeverity } from "./contract";

/**
 * Deterministic diagnostic collection. Codes are emitted at most once, counts are merged, and the
 * final order is fixed by severity and then by the declared code order, so the same data always
 * produces the same status text and the same DOM.
 */
const CODE_ORDER: readonly DiagnosticCode[] = [
    "needsEntity",
    "needsBand",
    "needsProfile",
    "hierarchyDepthUnsupported",
    "profilesOverLimit",
    "seriesOverLimit",
    "entitiesOverLimit",
    "periodsOverLimit",
    "bandsOverLimit",
    "tooltipFieldsOverLimit",
    "cellsOverLimit",
    "duplicateCells",
    "nonNumericValues",
    "nonFiniteValues",
    "negativeProfileValues",
    "blankValues",
    "zeroDenominator",
    "partialData",
    "segmentLimitReached",
    "extensionRolesProfileOnly",
    "invalidCoordinates",
    "conflictingCoordinates",
    "incompleteCoordinates",
    "oversizedGeometry",
    "emptyGeometry",
    "nonFiniteContextValue",
    "geometryUpdateBudgetExceeded",
    "geometryParseRejected",
    "geometryFeatureLimit",
    "geometryRingLimit",
    "geometryVertexLimit",
    "contextProviderUnavailable",
    "contextScenePartial",
    "packArtifactInvalid",
    "malformedPackKey",
    "unsupportedPackKey",
    "unmatchedPackKey",
    "duplicatePackKey",
    "fallbackEntityInvalid",
    "hostSelectionRejected",
    "highlightActive",
    "interactionsDisabled"
];

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2
};

const SEVERITY_BY_CODE: Record<DiagnosticCode, DiagnosticSeverity> = {
    needsEntity: "info",
    needsBand: "info",
    needsProfile: "info",
    hierarchyDepthUnsupported: "error",
    profilesOverLimit: "warning",
    seriesOverLimit: "warning",
    entitiesOverLimit: "warning",
    periodsOverLimit: "warning",
    bandsOverLimit: "warning",
    tooltipFieldsOverLimit: "warning",
    cellsOverLimit: "warning",
    duplicateCells: "warning",
    blankValues: "info",
    nonNumericValues: "warning",
    nonFiniteValues: "warning",
    negativeProfileValues: "warning",
    zeroDenominator: "warning",
    partialData: "warning",
    segmentLimitReached: "warning",
    highlightActive: "info",
    interactionsDisabled: "info",
    extensionRolesProfileOnly: "warning",
    invalidCoordinates: "warning",
    conflictingCoordinates: "warning",
    incompleteCoordinates: "warning",
    oversizedGeometry: "warning",
    emptyGeometry: "warning",
    nonFiniteContextValue: "warning",
    geometryUpdateBudgetExceeded: "warning",
    geometryParseRejected: "warning",
    geometryFeatureLimit: "warning",
    geometryRingLimit: "warning",
    geometryVertexLimit: "warning",
    contextProviderUnavailable: "warning",
    contextScenePartial: "warning",
    malformedPackKey: "warning",
    unsupportedPackKey: "warning",
    unmatchedPackKey: "warning",
    duplicatePackKey: "warning",
    packArtifactInvalid: "error",
    fallbackEntityInvalid: "warning",
    hostSelectionRejected: "warning"
};

export interface DiagnosticInput {
    readonly received?: number;
    readonly retained?: number;
    readonly rejected?: number;
    readonly detail?: string;
}

export function messageKeyFor(code: DiagnosticCode): string {
    return `Diagnostic_${code.charAt(0).toUpperCase()}${code.slice(1)}`;
}

export class DiagnosticCollector {
    private readonly entries = new Map<DiagnosticCode, Diagnostic>();

    public add(code: DiagnosticCode, input: DiagnosticInput = {}): void {
        const existing = this.entries.get(code);
        const merged: Diagnostic = {
            code,
            severity: SEVERITY_BY_CODE[code],
            messageKey: messageKeyFor(code),
            received: sum(existing?.received, input.received),
            retained: pick(existing?.retained, input.retained),
            rejected: sum(existing?.rejected, input.rejected),
            detail: input.detail ?? existing?.detail
        };
        this.entries.set(code, stripUndefined(merged));
    }

    public has(code: DiagnosticCode): boolean {
        return this.entries.has(code);
    }

    public build(): readonly Diagnostic[] {
        return [...this.entries.values()].sort(compareDiagnostics);
    }
}

export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
    const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (bySeverity !== 0) {
        return bySeverity;
    }
    return CODE_ORDER.indexOf(left.code) - CODE_ORDER.indexOf(right.code);
}

export function severityOf(code: DiagnosticCode): DiagnosticSeverity {
    return SEVERITY_BY_CODE[code];
}

function sum(left: number | undefined, right: number | undefined): number | undefined {
    if (left === undefined) {
        return right;
    }
    if (right === undefined) {
        return left;
    }
    return left + right;
}

function pick(left: number | undefined, right: number | undefined): number | undefined {
    return right === undefined ? left : right;
}

function stripUndefined(diagnostic: Diagnostic): Diagnostic {
    const result: Record<string, unknown> = {
        code: diagnostic.code,
        severity: diagnostic.severity,
        messageKey: diagnostic.messageKey
    };
    if (diagnostic.received !== undefined) {
        result.received = diagnostic.received;
    }
    if (diagnostic.retained !== undefined) {
        result.retained = diagnostic.retained;
    }
    if (diagnostic.rejected !== undefined) {
        result.rejected = diagnostic.rejected;
    }
    if (diagnostic.detail !== undefined) {
        result.detail = diagnostic.detail;
    }
    return result as unknown as Diagnostic;
}
