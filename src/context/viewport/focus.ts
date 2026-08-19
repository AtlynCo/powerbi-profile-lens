import { IMPLICIT_INDEX } from "../../model/contract";
import type { EntityRef, ProfileDataModel } from "../../model/contract";
import type {
    ContextEntityBinding,
    ContextFeature,
    ContextScene
} from "../contract";

export type ContextFocusSource =
    | "modelDefault"
    | "probe"
    | "contextPointer"
    | "contextKeyboard"
    | "entityList";

export interface ProfileDetailCoverage {
    readonly loadedPeriodIndexesByEntity: ReadonlyMap<number, ReadonlySet<number>>;
}

interface FocusBase {
    readonly source: ContextFocusSource;
    readonly feature: ContextFeature | null;
    readonly featureKey: string | null;
    readonly renderToken: string;
    readonly announcementToken: string;
}

export interface LoadedEntityFocus extends FocusBase {
    readonly kind: "loadedEntity";
    readonly binding: ContextEntityBinding | null;
    readonly entityIndex: number;
    readonly entityKey: string;
    readonly entityLabel: string;
    readonly periodIndex: number;
    readonly periodKey: string | null;
}

export interface UnboundFeatureFocus extends FocusBase {
    readonly kind: "unboundFeature";
    readonly feature: ContextFeature;
    readonly featureKey: string;
}

export interface UnloadedEntityFocus extends FocusBase {
    readonly kind: "unloadedEntity";
    readonly binding: ContextEntityBinding | null;
    readonly entityIndex: number;
    readonly entityKey: string;
    readonly entityLabel: string;
}

export interface NoFeatureFocus extends FocusBase {
    readonly kind: "noFeature";
}

export interface FallbackEntityFocus extends FocusBase {
    readonly kind: "fallbackEntity";
    readonly entityIndex: number;
    readonly entityKey: string;
    readonly entityLabel: string;
    readonly periodIndex: number;
    readonly periodKey: string | null;
}

export type ContextFocusState =
    | LoadedEntityFocus
    | UnboundFeatureFocus
    | UnloadedEntityFocus
    | NoFeatureFocus
    | FallbackEntityFocus;

export type FallbackResolution =
    | { readonly kind: "disabled" }
    | {
        readonly kind: "invalid";
        readonly reason: "tooLong" | "notFound" | "ambiguous" | "unloaded";
      }
    | {
        readonly kind: "valid";
        readonly entity: EntityRef;
      };

export const MAX_FALLBACK_ENTITY_KEY_CHARACTERS = 256;

export function buildProfileDetailCoverage(model: ProfileDataModel): ProfileDetailCoverage {
    const mutable = new Map<number, Set<number>>();
    for (const cell of model.cells) {
        const periods = mutable.get(cell.entityIndex) ?? new Set<number>();
        periods.add(cell.periodIndex);
        mutable.set(cell.entityIndex, periods);
    }
    return { loadedPeriodIndexesByEntity: mutable };
}

export function resolveFallbackEntity(
    model: ProfileDataModel,
    coverage: ProfileDetailCoverage,
    configuredKey: string
): FallbackResolution {
    if (configuredKey.length === 0) {
        return { kind: "disabled" };
    }
    if (configuredKey.length > MAX_FALLBACK_ENTITY_KEY_CHARACTERS) {
        return { kind: "invalid", reason: "tooLong" };
    }
    const matches = model.entities.filter((entity) =>
        typeof entity.value === "string" && entity.value === configuredKey);
    if (matches.length === 0) {
        return { kind: "invalid", reason: "notFound" };
    }
    if (matches.length > 1) {
        return { kind: "invalid", reason: "ambiguous" };
    }
    const entity = matches[0];
    const period = resolveLoadedPeriod(model, coverage, entity.index, null);
    if (!period) {
        return { kind: "invalid", reason: "unloaded" };
    }
    return { kind: "valid", entity };
}

export function resolveFeatureFocus(
    scene: ContextScene,
    model: ProfileDataModel,
    coverage: ProfileDetailCoverage,
    featureKey: string | null,
    selectedPeriodKey: string | null,
    fallback: FallbackResolution,
    source: ContextFocusSource,
    modelRevision: number
): ContextFocusState {
    if (featureKey === null) {
        if (fallback.kind === "valid") {
            const period = resolveLoadedPeriod(
                model,
                coverage,
                fallback.entity.index,
                selectedPeriodKey
            );
            if (!period) {
                throw new Error("Validated fallback Entity lost its loaded detail.");
            }
            const state = {
                kind: "fallbackEntity" as const,
                source,
                feature: null,
                featureKey: null,
                entityIndex: fallback.entity.index,
                entityKey: fallback.entity.key,
                entityLabel: fallback.entity.label,
                periodIndex: period.index,
                periodKey: period.key
            };
            return withTokens(state, modelRevision);
        }
        return withTokens({
            kind: "noFeature" as const,
            source,
            feature: null,
            featureKey: null
        }, modelRevision);
    }

    const feature = scene.backdrop.featureByKey.get(featureKey);
    if (!feature) {
        throw new Error(`Probe resolved unknown Context feature "${featureKey}".`);
    }
    const binding = scene.entities.byFeatureKey.get(feature.key);
    if (!binding) {
        return withTokens({
            kind: "unboundFeature" as const,
            source,
            feature,
            featureKey: feature.key
        }, modelRevision);
    }
    return resolveEntityFocus(
        model,
        coverage,
        binding.entityIndex,
        selectedPeriodKey,
        source,
        modelRevision,
        feature,
        binding
    );
}

export function resolveEntityFocus(
    model: ProfileDataModel,
    coverage: ProfileDetailCoverage,
    entityIndex: number,
    selectedPeriodKey: string | null,
    source: ContextFocusSource,
    modelRevision: number,
    feature: ContextFeature | null = null,
    binding: ContextEntityBinding | null = null
): ContextFocusState {
    const entity = model.entities[entityIndex];
    if (!entity) {
        throw new Error(`Context focus references missing Entity index ${entityIndex}.`);
    }
    const period = resolveLoadedPeriod(model, coverage, entityIndex, selectedPeriodKey);
    if (!period) {
        return withTokens({
            kind: "unloadedEntity" as const,
            source,
            feature,
            featureKey: feature?.key ?? null,
            binding,
            entityIndex,
            entityKey: entity.key,
            entityLabel: entity.label
        }, modelRevision);
    }
    return withTokens({
        kind: "loadedEntity" as const,
        source,
        feature,
        featureKey: feature?.key ?? null,
        binding,
        entityIndex,
        entityKey: entity.key,
        entityLabel: entity.label,
        periodIndex: period.index,
        periodKey: period.key
    }, modelRevision);
}

function resolveLoadedPeriod(
    model: ProfileDataModel,
    coverage: ProfileDetailCoverage,
    entityIndex: number,
    selectedPeriodKey: string | null
): { readonly index: number; readonly key: string | null } | null {
    const loaded = coverage.loadedPeriodIndexesByEntity.get(entityIndex);
    if (!loaded || loaded.size === 0) {
        return null;
    }
    if (loaded.has(IMPLICIT_INDEX)) {
        return { index: IMPLICIT_INDEX, key: null };
    }
    const periods = model.periodsByEntity.get(entityIndex) ?? [];
    if (selectedPeriodKey !== null) {
        const selected = periods.find((period) =>
            period.key === selectedPeriodKey && loaded.has(period.index));
        if (selected) {
            return { index: selected.index, key: selected.key };
        }
    }
    const first = periods.find((period) => loaded.has(period.index));
    return first ? { index: first.index, key: first.key } : null;
}

function withTokens<T extends Omit<ContextFocusState, "renderToken" | "announcementToken">>(
    state: T,
    modelRevision: number
): T & Pick<ContextFocusState, "renderToken" | "announcementToken"> {
    const periodKey = "periodKey" in state ? state.periodKey ?? "implicit" : "";
    const entityKey = "entityKey" in state ? state.entityKey : "";
    const featureKey = state.featureKey ?? "none";
    const announcementToken = [
        state.kind,
        featureKey,
        entityKey,
        periodKey
    ].join("|");
    return {
        ...state,
        announcementToken,
        renderToken: `${announcementToken}|revision:${modelRevision}`
    };
}
