/* eslint-disable powerbi-visuals/non-literal-fs-path */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
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
const {
    AUTOMATION_PATHS,
    assertCleanBoundSource,
    computeAutomationIntegrity
} = require("../scripts/native-source-integrity.cjs") as {
    AUTOMATION_PATHS: string[];
    assertCleanBoundSource(root: string): string;
    computeAutomationIntegrity(root: string): { sha256: string };
};
const { assertEvidenceSafe, sanitizeEvidence } = require("../scripts/native-evidence-sanitize.cjs") as {
    assertEvidenceSafe(value: unknown, usernames?: string[]): void;
    sanitizeEvidence(value: unknown, usernames?: string[]): unknown;
};
const { verifySampleResourceParity } = require("../scripts/sample-resource-parity.cjs") as {
    verifySampleResourceParity(options: {
        packagePath: string;
        sampleRoot: string;
        guid: string;
    }): Promise<{ parity: boolean; payload: { sha256: string }; embedded: Array<{ sha256: string }> }>;
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
        expect(combined).toContain("sample-integrity.cjs");
        expect(combined).toContain("native-source-integrity.cjs");
        expect(combined).toContain("native-evidence-sanitize.cjs");
        expect(combined).toContain("sample-resource-parity.cjs");
        expect(combined).toContain("scenarioResults");
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

    it("rejects duplicate bounded UIA candidates", () => {
        const command = ". 'scripts\\native-validation\\desktop-guard.ps1'; "
            + "try { Select-UniqueCandidate -Candidates @(1,2) -LogicalName 'duplicate' } "
            + "catch { $_.Exception.Message }";
        const output = execFileSync("pwsh", ["-NoProfile", "-Command", command], {
            cwd: root,
            stdio: "pipe"
        }).toString();
        expect(output).toMatch(/Ambiguous owned UIA target/);
    });

    it("redacts adversarial generated output before the actual evidence path", () => {
        const adversarial = {
            error: "C:\\Users\\Alice Smith\\repo\\secret and c:/USERS/alICE smith/repo/file plus "
                + "/home/Bob Smith/report and file:///C:/Users/Alice Smith/x and ALICE@Example.com "
                + "\\\\fileserver\\private share\\report.pbix and //server/private/report.pbix",
            username: "Alice",
            processId: 42,
            nested: { value: "https://example.com/private?q=alice" }
        };
        const sanitized = sanitizeEvidence(adversarial, ["Alice"]);
        assertEvidenceSafe(sanitized, ["Alice"]);
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-lens-evidence-"));
        const output = path.join(temp, "native-run.json");
        fs.writeFileSync(output, JSON.stringify(sanitized));
        try {
            const persisted = fs.readFileSync(output, "utf8");
            expect(persisted).not.toMatch(
                /[A-Z]:[\\/]|\/Users\/|\/home\/|file:|https?:|@|\\\\fileserver|\/\/server/i
            );
            expect(persisted).not.toMatch(/Alice|Bob|processId|username/i);
            expect(persisted).toContain("[redacted]");
        } finally {
            fs.rmSync(temp, { recursive: true, force: true });
        }

        const actualOutput = path.join(
            root,
            "dist",
            "release",
            "native-evidence",
            "native-run.json"
        );
        if (fs.existsSync(actualOutput)) {
            expect(() => assertEvidenceSafe(
                JSON.parse(fs.readFileSync(actualOutput, "utf8")) as unknown,
                [process.env.USERNAME ?? "", process.env.USER ?? ""]
            )).not.toThrow();
        }
    });

    it("binds automation files and rejects a local guard mutation", () => {
        const baseline = computeAutomationIntegrity(root);
        expect(AUTOMATION_PATHS).toContain("scripts/native-validation");
        expect(baseline.sha256).toMatch(/^[0-9a-f]{64}$/);

        const temp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-lens-source-"));
        try {
            fs.mkdirSync(path.join(temp, "scripts", "native-validation"), { recursive: true });
            fs.writeFileSync(path.join(temp, "scripts", "native-validation", "guard.ps1"), "guard\n");
            execFileSync("git", ["init", "--quiet"], { cwd: temp });
            execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: temp });
            execFileSync("git", ["config", "user.name", "Integrity Test"], { cwd: temp });
            execFileSync("git", ["add", "."], { cwd: temp });
            execFileSync("git", ["commit", "--quiet", "-m", "baseline"], { cwd: temp });
            expect(assertCleanBoundSource(temp)).toMatch(/^[0-9a-f]{40}$/);
            fs.appendFileSync(
                path.join(temp, "scripts", "native-validation", "guard.ps1"),
                "mutation\n"
            );
            expect(() => assertCleanBoundSource(temp)).toThrow(/dirty/i);
            const runner = fs.readFileSync(
                path.join(root, "scripts", "native-validation", "run-desktop-validation.ps1"),
                "utf8"
            );
            const release = fs.readFileSync(
                path.join(root, "scripts", "release-manifest.cjs"),
                "utf8"
            );
            expect(runner).toContain("native-source-integrity.cjs");
            expect(release).toContain("assertBoundSourceMatchesCommit");
            expect(release).toContain("assertCleanBoundSource");
            expect(release).toContain("writeFileAtomic.sync");
        } finally {
            fs.rmSync(temp, { recursive: true, force: true });
        }
    });

    it("proves final PBIVIZ payload parity and rejects embedded drift", async () => {
        const packagePath = path.join(root, "dist", "atlynProfileLens.1.2.0.0.pbiviz");
        const sampleRoot = path.join(root, "samples", "AtlynProfileLensSample");
        const parity = await verifySampleResourceParity({
            packagePath,
            sampleRoot,
            guid: "atlynProfileLens"
        });
        expect(parity.parity).toBe(true);
        expect(parity.embedded).toHaveLength(1);
        expect(parity.embedded[0]?.sha256).toBe(parity.payload.sha256);

        const temp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-lens-parity-"));
        const target = path.join(
            temp,
            "Report",
            "CustomVisuals",
            "atlynProfileLens",
            "resources",
            "atlynProfileLens.pbiviz.json"
        );
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, "drift");
        try {
            await expect(verifySampleResourceParity({
                packagePath,
                sampleRoot: temp,
                guid: "atlynProfileLens"
            })).rejects.toThrow(/differs/i);
        } finally {
            fs.rmSync(temp, { recursive: true, force: true });
        }
    });
});
