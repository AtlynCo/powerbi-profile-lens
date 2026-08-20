import type {
    ContextEntityBinding,
    ContextFeature,
    ContextMode,
    ContextProvider,
    ContextProviderInput,
    ContextScene
} from "../contract";
import type { Diagnostic, DiagnosticCode, EntityRef } from "../../model/contract";
import { LIMITS } from "../../model/contract";
import { messageKeyFor } from "../../model/diagnostics";
import { compareStableKeys } from "../../model/stableKey";
import { safeRawExcerpt, scene } from "../providers/common";
import type {
    ContextPackArtifact,
    ProjectedContextPack,
    ProjectedPackFeature
} from "./contract";
import { projectContextPack } from "./projection";
import { ContextPackRegistry } from "./registry";

interface NormalizedEntity {
    readonly entity: EntityRef;
    readonly canonicalKey: string;
}

interface KeyFailure {
    readonly code: "malformedPackKey" | "unsupportedPackKey";
    readonly example: string;
}

interface FailureGroup {
    readonly examples: string[];
    count: number;
}

export class StaticContextPackProvider implements ContextProvider {
    public readonly id = "built-in-context-pack";
    public readonly modes: readonly ContextMode[] = ["builtInPack"];
    private readonly projected = new Map<string, ProjectedContextPack>();
    private readonly backdrops = new Map<string, readonly ContextFeature[]>();

    public constructor(private readonly packs: ContextPackRegistry = new ContextPackRegistry()) {}

    public canProvide(mode: ContextMode, input: ContextProviderInput): boolean {
        return mode === "builtInPack" && input.pack !== undefined;
    }

    public provide(_mode: ContextMode, input: ContextProviderInput): ContextScene {
        if (!input.pack) {
            return scene(this.id, "builtInPack", [], [], [diagnostic("packArtifactInvalid")]);
        }
        const artifact = this.packs.resolve(input.pack.id);
        if (!artifact) {
            return scene(this.id, "builtInPack", [], [], [diagnostic(
                "packArtifactInvalid",
                [`Unknown pack ${input.pack.id}`]
            )]);
        }
        let pack: ProjectedContextPack;
        try {
            pack = this.resolveProjected(artifact);
        } catch (error) {
            return scene(this.id, "builtInPack", [], [], [diagnostic(
                "packArtifactInvalid",
                [error instanceof Error ? error.message : String(error)]
            )]);
        }
        const byCanonicalKey = new Map(
            pack.features.map((entry) => [entry.properties.canonicalKey, entry])
        );
        const normalized: NormalizedEntity[] = [];
        const failures = new Map<DiagnosticCode, FailureGroup>();
        for (const entity of input.entities) {
            const result = normalizeKey(entity.value, artifact, input.pack.keyMode);
            if ("code" in result) {
                addExample(failures, result.code, result.example);
            } else if (!byCanonicalKey.has(result.canonicalKey)) {
                addExample(failures, "unmatchedPackKey", result.canonicalKey);
            } else {
                normalized.push({ entity, canonicalKey: result.canonicalKey });
            }
        }
        const groups = new Map<string, NormalizedEntity[]>();
        for (const entry of normalized) {
            const group = groups.get(entry.canonicalKey) ?? [];
            group.push(entry);
            groups.set(entry.canonicalKey, group);
        }
        const retained = normalized.filter((entry) => {
            const duplicate = (groups.get(entry.canonicalKey)?.length ?? 0) > 1;
            if (duplicate) {
                addExample(failures, "duplicatePackKey", entry.canonicalKey);
            }
            return !duplicate;
        });
        const features = this.resolveBackdrop(pack);
        const bindings = retained.map((entry) => contextBinding(entry, input));
        if (features.length > LIMITS.maxBuiltInPackFeatures) {
            addExample(
                failures,
                "geometryFeatureLimit",
                String(features.length),
                features.length - LIMITS.maxBuiltInPackFeatures
            );
        }
        const diagnostics = [...failures.entries()].map(([code, group]) =>
            diagnostic(
                code,
                group.examples,
                input.entities.length,
                bindings.length,
                group.count
            ));
        return {
            ...scene(this.id, "builtInPack", features, bindings, diagnostics),
            cartography: pack.cartography,
            metadata: {
                displayName: pack.manifest.displayName,
                vintage: pack.manifest.vintage,
                attribution: pack.manifest.attribution,
                policyId: pack.manifest.policyId
            }
        };
    }

    private resolveProjected(artifact: ContextPackArtifact): ProjectedContextPack {
        const cached = this.projected.get(artifact.manifest.id);
        if (cached) {
            return cached;
        }
        const projected = projectContextPack(artifact);
        this.projected.set(artifact.manifest.id, projected);
        return projected;
    }

    private resolveBackdrop(pack: ProjectedContextPack): readonly ContextFeature[] {
        const cached = this.backdrops.get(pack.manifest.id);
        if (cached) {
            return cached;
        }
        if (pack.features.length > LIMITS.maxBuiltInPackFeatures) {
            throw new Error(
                `Pack ${pack.manifest.id} has ${pack.features.length} features, above the `
                + `${LIMITS.maxBuiltInPackFeatures} trusted feature limit.`
            );
        }
        const keys = new Set(pack.features.map((entry) => entry.properties.canonicalKey));
        const features = pack.features.map((entry, index) =>
            contextFeature(entry, keys, index));
        this.backdrops.set(pack.manifest.id, features);
        return features;
    }
}

function normalizeKey(
    value: EntityRef["value"],
    artifact: ContextPackArtifact,
    keyMode: string
): { readonly canonicalKey: string } | KeyFailure {
    if (typeof value !== "string") {
        return { code: "malformedPackKey", example: safeValue(value) };
    }
    if (artifact.manifest.level === "country") {
        if (keyMode === "canonical") {
            return /^[A-Z]{3}$/.test(value) || /^NE:[A-Z0-9]{3}$/.test(value)
                ? { canonicalKey: value }
                : { code: "malformedPackKey", example: safeValue(value) };
        }
        if (keyMode === "isoAlpha3CaseFold") {
            if (/^NE:/.test(value)) {
                return { code: "unsupportedPackKey", example: safeValue(value) };
            }
            return /^[A-Za-z]{3}$/.test(value)
                ? { canonicalKey: value.toUpperCase() }
                : { code: "malformedPackKey", example: safeValue(value) };
        }
        return { code: "unsupportedPackKey", example: safeValue(value) };
    }
    const expectedMode = artifact.manifest.level === "state" ? "geoid2" : "geoid5";
    const expectedPattern = artifact.manifest.level === "state" ? /^\d{2}$/ : /^\d{5}$/;
    if (keyMode !== expectedMode) {
        return { code: "unsupportedPackKey", example: safeValue(value) };
    }
    return expectedPattern.test(value)
        ? { canonicalKey: value }
        : { code: "malformedPackKey", example: safeValue(value) };
}

function contextFeature(
    packFeature: ProjectedPackFeature,
    featureKeys: ReadonlySet<string>,
    index: number
): ContextFeature {
    const status = packFeature.properties.status.length > 0
        ? `, source status ${packFeature.properties.status}`
        : "";
    const navigationKeys = packFeature.properties.neighbors
        .filter((key) => featureKeys.has(key))
        .sort(compareStableKeys);
    const metadata: Record<string, string | number | boolean> = {
        canonicalKey: packFeature.properties.canonicalKey,
        sourceId: packFeature.properties.sourceId,
        status: packFeature.properties.status,
        region: packFeature.properties.region,
        fallback: packFeature.properties.fallback,
        codeSource: packFeature.properties.codeSource
    };
    if (packFeature.properties.stateCode !== undefined) {
        metadata.stateCode = packFeature.properties.stateCode;
    }
    return {
        index,
        key: packFeature.properties.canonicalKey,
        label: packFeature.properties.name,
        description: `${packFeature.properties.name}, cartographic key `
            + `${packFeature.properties.canonicalKey}${status}`,
        geometry: packFeature.geometry,
        navigationKeys,
        metadata
    };
}

function contextBinding(
    match: NormalizedEntity,
    input: ContextProviderInput
): ContextEntityBinding {
    const contextValue = input.contextValues.get(match.entity.index) ?? null;
    return {
        featureKey: match.canonicalKey,
        entityIndex: match.entity.index,
        entityKey: match.entity.key,
        entityLabel: match.entity.label,
        selection: input.entityIdentities.get(match.entity.index) ?? (
            match.entity.identity === null
                ? null
                : { key: match.entity.key, hostIdentity: match.entity.identity }
        ),
        contextValue,
        tooltipValues: contextValue === null
            ? []
            : [{ displayName: "Context value", value: String(contextValue) }]
    };
}

function diagnostic(
    code: DiagnosticCode,
    examples: readonly string[] = [],
    received?: number,
    retained?: number,
    rejected?: number
): Diagnostic {
    return {
        code,
        severity: code === "packArtifactInvalid" ? "error" : "warning",
        messageKey: messageKeyFor(code),
        received,
        retained,
        rejected,
        detail: examples.length > 0 ? examples.join(", ") : undefined
    };
}

function addExample(
    failures: Map<DiagnosticCode, FailureGroup>,
    code: DiagnosticCode,
    example: string,
    count = 1
): void {
    const group = failures.get(code) ?? { examples: [], count: 0 };
    const examples = group.examples;
    if (
        examples.length < LIMITS.maxDiagnosticExamples
        && !examples.includes(example)
    ) {
        examples.push(example);
    }
    group.count += count;
    failures.set(code, group);
}

function safeValue(value: EntityRef["value"]): string {
    if (value instanceof Date) {
        return safeRawExcerpt(value.toISOString());
    }
    return safeRawExcerpt(String(value));
}
