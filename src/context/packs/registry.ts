import world110 from "./generated/world-countries-110m.pack.json";
import world50 from "./generated/world-countries-50m.pack.json";
import states from "./generated/us-states-2025-5m.pack.json";
import counties from "./generated/us-counties-2025-5m.pack.json";
import type { ContextPackArtifact, ContextPackManifest } from "./contract";

const BUILT_IN_ARTIFACTS = [
    world110,
    world50,
    states,
    counties
] as readonly unknown[];

export class ContextPackRegistry {
    private readonly artifacts = new Map<string, ContextPackArtifact>();

    public constructor(artifacts: readonly unknown[] = BUILT_IN_ARTIFACTS) {
        for (const candidate of artifacts) {
            const artifact = parseArtifact(candidate);
            if (this.artifacts.has(artifact.manifest.id)) {
                throw new Error(`Context pack "${artifact.manifest.id}" is already registered.`);
            }
            this.artifacts.set(artifact.manifest.id, artifact);
        }
    }

    public resolve(id: string): ContextPackArtifact | null {
        return this.artifacts.get(id) ?? null;
    }

    public manifests(): readonly ContextPackManifest[] {
        return [...this.artifacts.values()].map((artifact) => artifact.manifest);
    }
}

function parseArtifact(candidate: unknown): ContextPackArtifact {
    if (!isRecord(candidate) || !isRecord(candidate.manifest) || !isRecord(candidate.topology)) {
        throw new Error("Context pack artifact is malformed.");
    }
    const manifest = candidate.manifest;
    if (
        manifest.schemaVersion !== 1
        || typeof manifest.id !== "string"
        || typeof manifest.featureCount !== "number"
        || !Array.isArray(manifest.keyModes)
    ) {
        throw new Error("Context pack manifest is incompatible.");
    }
    return candidate as unknown as ContextPackArtifact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
