import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const repositoryUrl = "https://github.com/AtlynCo/powerbi-profile-lens";
const supportUrl = "https://www.atlynco.com/docs/faq";

interface PackageMetadata {
    readonly repository: { readonly type: string; readonly url: string };
    readonly version: string;
    readonly dependencies: Record<string, string>;
}

interface SamplePackageMetadata {
    readonly version: string;
    readonly visual: { readonly gitHubUrl: string };
}

interface VisualManifest {
    readonly apiVersion: string;
    readonly dependencies: null;
    readonly externalJS: readonly string[];
    readonly visual: {
        readonly description: string;
        readonly gitHubUrl: string;
        readonly guid: string;
        readonly supportUrl: string;
        readonly version: string;
    };
}

interface Capabilities {
    readonly privileges: readonly unknown[];
    readonly objects?: Record<string, unknown>;
}

function readJson<T>(relativePath: string): T {
    return JSON.parse(readFileSync(join(root, relativePath), "utf8")) as T;
}

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : [path];
    });
}

describe("certification metadata contract", () => {
    it("pins the exact source, identity, support, version, and API metadata", () => {
        const packageJson = readJson<PackageMetadata>("package.json");
        const manifest = readJson<VisualManifest>("pbiviz.json");
        const samplePackage = readJson<SamplePackageMetadata>(
            "samples/AtlynProfileLensSample/AtlynProfileLensSample.Report/CustomVisuals/atlynProfileLens/package.json"
        );
        const sampleResource = readJson<VisualManifest>(
            "samples/AtlynProfileLensSample/AtlynProfileLensSample.Report/CustomVisuals/atlynProfileLens/resources/atlynProfileLens.pbiviz.json"
        );

        expect(packageJson.repository).toEqual({ type: "git", url: repositoryUrl });
        expect(packageJson.version).toBe("1.9.1");
        expect(packageJson.dependencies["powerbi-visuals-api"]).toBe("5.11.0");
        for (const metadata of [manifest, sampleResource]) {
            expect(metadata.apiVersion).toBe("5.11.0");
            expect(metadata.visual.guid).toBe("atlynProfileLens");
            expect(metadata.visual.version).toBe("1.9.1.1");
            expect(metadata.visual.supportUrl).toBe(supportUrl);
            expect(metadata.visual.gitHubUrl).toBe(repositoryUrl);
        }
        expect(samplePackage.version).toBe("1.9.1.1");
        expect(samplePackage.visual.gitHubUrl).toBe(repositoryUrl);
    });

    it("keeps the visual offline with no OSM, WebAccess, or external request surface", () => {
        const manifest = readJson<VisualManifest>("pbiviz.json");
        const capabilities = readJson<Capabilities>("capabilities.json");
        expect(manifest.dependencies).toBeNull();
        expect(manifest.externalJS).toEqual([]);
        expect(capabilities.privileges).toEqual([]);
        expect(capabilities.objects?.general).toBeUndefined();

        const source = sourceFiles(join(root, "src"))
            .filter((file) => file.endsWith(".ts"))
            .map((file) => readFileSync(file, "utf8"))
            .join("\n");
        expect(source).not.toMatch(/\b(?:OSM|WebAccess)\b/i);
        expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
        expect(source).not.toMatch(/\b(?:eval|applyJsonFilter)\s*\(/);
    });
});
