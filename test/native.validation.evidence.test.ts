/* eslint-disable powerbi-visuals/non-literal-fs-path */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { computeSampleIntegrity } = require("../scripts/sample-integrity.cjs") as {
    computeSampleIntegrity(options: {
        root: string;
        sampleRoot: string;
        generatorPath: string;
        guid: string;
    }): unknown;
};

describe("native validation evidence safety", () => {
    it("uses no race-prone global input or broad UIA capture", () => {
        const guard = fs.readFileSync(
            path.join(root, "scripts", "native-validation", "desktop-guard.ps1"),
            "utf8"
        );
        const runner = fs.readFileSync(
            path.join(root, "scripts", "native-validation", "run-desktop-validation.ps1"),
            "utf8"
        );
        const combined = `${guard}\n${runner}`;
        expect(combined).not.toMatch(/SendKeys|keybd_event|mouse_event|FindAll\([\s\S]*TrueCondition/);
        expect(combined).not.toMatch(/PrintWindow|Capture-OwnedWindow|Get-OwnedUiaProbe/);
        expect(combined).toContain("ValuePattern");
        expect(combined).toContain("InvokePattern");
        expect(combined).toContain("Assert-ControlInsideDialog");
        expect(combined).toContain('-AutomationId "1001"');
        expect(combined).toContain("GetRelativePath");
        expect(combined).toContain("status --porcelain --untracked-files=all");
        expect(combined).toContain("sample-integrity.cjs");
    });

    it("contains no user, home, account, or unrelated window capture", () => {
        const evidenceDirectory = path.join(root, "docs", "native-validation");
        const evidence = fs.readdirSync(evidenceDirectory)
            .map((entry) => fs.readFileSync(path.join(evidenceDirectory, entry), "utf8"))
            .join("\n");
        expect(evidence).not.toMatch(/[A-Z]:\\Users\\/i);
        expect(evidence).not.toMatch(/\/Users\/|\/home\/|ghamers|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i);
        expect(evidence).not.toMatch(/MainWindowTitle|automationId|processId/i);
    });

    it("recomputes the committed sample integrity manifest exactly", () => {
        const sampleRoot = path.join(root, "samples", "AtlynProfileLensSample");
        const recorded = JSON.parse(
            fs.readFileSync(path.join(sampleRoot, "sample-integrity.json"), "utf8")
        ) as unknown;
        const computed = computeSampleIntegrity({
            root,
            sampleRoot,
            generatorPath: path.join(root, "scripts", "build-sample-report.cjs"),
            guid: "atlynProfileLens"
        });
        expect(computed).toEqual(recorded);
    });
});
