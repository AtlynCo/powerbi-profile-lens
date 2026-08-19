import type {
    ContextEntityBinding,
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
): { readonly feature: ContextFeature; readonly binding: ContextEntityBinding } {
    const contextValue = input.contextValues.get(entity.index) ?? null;
    const geometryDescription = geometry.kind === "point" ? "point"
        : geometry.kind === "multiPoint" ? "multiple points"
            : geometry.kind === "polygon" ? "path"
                : geometry.kind === "multiPolygon" ? "multiple paths"
                    : geometry.kind === "grid" ? "grid cell"
                        : "hex cell";
    return {
        feature: {
            index,
            key: entity.key,
            label: entity.label,
            description: `${entity.label}, ${geometryDescription}`,
            geometry
        },
        binding: {
            featureKey: entity.key,
            entityIndex: entity.index,
            entityKey: entity.key,
            entityLabel: entity.label,
            selection: input.entityIdentities.get(entity.index) ?? {
                key: entity.key,
                hostIdentity: entity.identity
            },
            contextValue,
            tooltipValues: contextValue === null
                ? []
                : [{ displayName: "Context value", value: String(contextValue) }]
        }
    };
}

export function scene(
    providerId: string,
    mode: ContextScene["mode"],
    features: readonly ContextFeature[],
    bindings: readonly ContextEntityBinding[] = [],
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
    const featureByKey = new Map<string, ContextFeature>();
    const featureIndexes = new Set<number>();
    for (const [position, feature] of features.entries()) {
        if (feature.index !== position) {
            throw new Error(
                `Context feature "${feature.key}" index ${feature.index} must equal its `
                + `ordered position ${position}.`
            );
        }
        if (featureByKey.has(feature.key)) {
            throw new Error(`Context feature key "${feature.key}" is duplicated.`);
        }
        if (featureIndexes.has(feature.index)) {
            throw new Error(`Context feature index ${feature.index} is duplicated.`);
        }
        featureByKey.set(feature.key, feature);
        featureIndexes.add(feature.index);
    }
    const byFeatureKey = new Map<string, ContextEntityBinding>();
    const featureKeyByEntityKey = new Map<string, string>();
    for (const binding of bindings) {
        if (!featureByKey.has(binding.featureKey)) {
            throw new Error(
                `Context Entity binding references missing feature "${binding.featureKey}".`
            );
        }
        if (byFeatureKey.has(binding.featureKey)) {
            throw new Error(
                `Context feature "${binding.featureKey}" has more than one Entity binding.`
            );
        }
        if (featureKeyByEntityKey.has(binding.entityKey)) {
            throw new Error(`Context Entity key "${binding.entityKey}" is bound more than once.`);
        }
        byFeatureKey.set(binding.featureKey, binding);
        featureKeyByEntityKey.set(binding.entityKey, binding.featureKey);
    }
    return {
        providerId,
        mode,
        backdrop: {
            features,
            featureByKey,
            metrics: { featureCount: features.length, ringCount, vertexCount }
        },
        entities: { byFeatureKey, featureKeyByEntityKey },
        diagnostics,
        partial: diagnostics.some(diagnostic => diagnostic.severity !== "info")
    };
}
