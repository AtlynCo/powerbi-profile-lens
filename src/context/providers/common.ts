import type {
    ContextFeature,
    ContextGeometry,
    ContextProviderInput,
    ContextScene
} from "../contract";
import type { Diagnostic, EntityRef } from "../../model/contract";
import { LIMITS } from "../../model/contract";

export function safeRawExcerpt(value: string): string {
    return value
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, "\uFFFD")
        .slice(0, LIMITS.maxDiagnosticExampleCharacters);
}

export function featureFor(
    entity: EntityRef,
    index: number,
    geometry: ContextGeometry,
    input: ContextProviderInput
): ContextFeature {
    const contextValue = input.contextValues.get(entity.index) ?? null;
    const geometryDescription = geometry.kind === "point" ? "point"
        : geometry.kind === "multiPoint" ? "multiple points"
            : geometry.kind === "polygon" ? "path"
                : geometry.kind === "multiPolygon" ? "multiple paths"
                    : geometry.kind === "grid" ? "grid cell"
                        : "hex cell";
    return {
        index,
        key: entity.key,
        entityIndex: entity.index,
        label: entity.label,
        description: contextValue === null
            ? `${entity.label}, ${geometryDescription}`
            : `${entity.label}, ${geometryDescription}, context value ${String(contextValue)}`,
        geometry,
        selection: input.entityIdentities.get(entity.index) ?? {
            key: entity.key,
            hostIdentity: entity.identity
        },
        contextValue,
        tooltipValues: contextValue === null
            ? []
            : [{ displayName: "Context value", value: String(contextValue) }]
    };
}

export function scene(
    providerId: string,
    mode: ContextScene["mode"],
    features: readonly ContextFeature[],
    diagnostics: readonly Diagnostic[] = []
): ContextScene {
    let ringCount = 0;
    let vertexCount = 0;
    for (const feature of features) {
        if (feature.geometry.points) {
            vertexCount += feature.geometry.points.length;
        }
        for (const polygon of feature.geometry.polygons ?? []) {
            ringCount += polygon.length;
            for (const ring of polygon) {
                vertexCount += ring.length;
            }
        }
    }
    return {
        providerId,
        mode,
        features,
        metrics: { featureCount: features.length, ringCount, vertexCount },
        diagnostics,
        partial: diagnostics.some(diagnostic => diagnostic.severity !== "info")
    };
}
