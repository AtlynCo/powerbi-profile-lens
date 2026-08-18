/* eslint-disable powerbi-visuals/non-literal-fs-path */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const visualManifest = JSON.parse(
    fs.readFileSync(path.join(root, "pbiviz.json"), "utf8")
) as { visual: { name: string; version: string } };
const currentPackagePath = path.join(
    root,
    "dist",
    `${visualManifest.visual.name}.${visualManifest.visual.version}.pbiviz`
);
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
const {
    parseExtraFields,
    requireCanonicalPbixResource,
    verifyPbixVisualParity
} = require("../scripts/sample-resource-parity.cjs") as {
    parseExtraFields(extra: Buffer): void;
    requireCanonicalPbixResource(names: string[], guid: string): string;
    verifyPbixVisualParity(options: {
        packagePath: string;
        pbixPath: string;
        guid: string;
    }): Promise<{
        presenceParity: boolean;
        activeParity: boolean;
        activePointer: { status: string };
    }>;
};
const {
    SCENARIO_REQUIREMENTS,
    deriveScenarioOutcomes,
    sealObservation
} = require("../scripts/native-observations.cjs") as {
    SCENARIO_REQUIREMENTS: Record<string, string[]>;
    deriveScenarioOutcomes(
        observations: unknown[],
        binding: { sourceCommit: string; snapshotSha256: string }
    ): Record<string, { outcome: string }>;
    sealObservation(observation: Record<string, unknown>): Record<string, unknown>;
};
const { manifest: snapshotManifest, verifySnapshot } = require("../scripts/native-snapshot.cjs") as {
    manifest(directory: string): { sha256: string };
    verifySnapshot(root: string, token: string, expected: string): { manifest: { sha256: string } };
};
const {
    createPbixSnapshot,
    verifyPbixSnapshot
} = require("../scripts/native-pbix-snapshot.cjs") as {
    createPbixSnapshot(root: string, source: string): {
        token: string;
        logicalPath: string;
        original: { sha256: string };
        snapshot: { sha256: string };
    };
    verifyPbixSnapshot(root: string, token: string): { snapshot: { sha256: string } };
};
const JSZip = require("jszip") as {
    loadAsync(bytes: Buffer): Promise<{ files: Record<string, { async(kind: string): Promise<Buffer> }> }>;
    new(): {
        file(name: string, value: string | Buffer): unknown;
        generateAsync(options: { type: string }): Promise<Buffer>;
    };
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
        expect(combined).toContain("native-observations.cjs");
        expect(combined).toContain("observations");
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

        for (const filename of ["native-run.json", "native-failure.json"]) {
            const actualOutput = path.join(
                root,
                "dist",
                "release",
                "native-evidence",
                filename
            );
            if (fs.existsSync(actualOutput)) {
                expect(() => assertEvidenceSafe(
                    JSON.parse(fs.readFileSync(actualOutput, "utf8")) as unknown,
                    [process.env.USERNAME ?? "", process.env.USER ?? ""]
                )).not.toThrow();
            }
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
            expect(runner).toContain("$visualManifest.visual.version");
            expect(runner).not.toContain("AtlynProfileLensSample-1.2.0.0.pbix");
            expect(release).toContain("assertBoundSourceMatchesCommit");
            expect(release).toContain("assertCleanBoundSource");
            expect(release).toContain("writeFileAtomic.sync");
            expect(release).toContain("REQUIRED_SCENARIOS");
            expect(release).toContain('outcome !== "passed"');
        } finally {
            fs.rmSync(temp, { recursive: true, force: true });
        }
    });

    it("proves final PBIVIZ payload parity and rejects embedded drift", async () => {
        const packagePath = currentPackagePath;
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

    it("derives scenario outcomes from sealed observations and ignores edited outcomes", () => {
        const binding = {
            sourceCommit: "a".repeat(40),
            snapshotSha256: "b".repeat(64)
        };
        const observations = [sealObservation({
            schemaVersion: 1,
            id: "pbix-offline-reopen",
            scenario: "pbixOfflineReopen",
            sequence: 1,
            timestamp: new Date(1000).toISOString(),
            ...binding,
            action: {
                kind: "reopen-verify",
                control: {
                    logicalName: "owned-report",
                    controlType: "Window",
                    automationId: ""
                }
            },
            before: { sha256: "1".repeat(64) },
            after: { sha256: "1".repeat(64) },
            expectedPredicate: { kind: "unchanged" }
        })];
        const derived = deriveScenarioOutcomes(observations, binding);
        expect(derived.pbixOfflineReopen?.outcome).toBe("passed");
        expect(derived.fieldWells?.outcome).toBe("unproven");

        const editableOutcomes = Object.fromEntries(
            Object.keys(SCENARIO_REQUIREMENTS).map((scenario) => [scenario, { outcome: "passed" }])
        );
        expect(editableOutcomes).not.toEqual(derived);
        expect(deriveScenarioOutcomes(observations, binding)).toEqual(derived);

        const tampered = structuredClone(observations);
        (tampered[0] as { after: { sha256: string } }).after.sha256 = "2".repeat(64);
        const rejected = deriveScenarioOutcomes(tampered, binding);
        expect(rejected.pbixOfflineReopen?.outcome).toBe("failed");

        const fabricatedFieldWell = sealObservation({
            schemaVersion: 1,
            id: "field-hierarchy-first",
            scenario: "fieldWells",
            sequence: 1,
            timestamp: new Date(1000).toISOString(),
            ...binding,
            action: {
                kind: "drag",
                control: {
                    logicalName: "hierarchy-field-well",
                    controlType: "ListItem",
                    automationId: ""
                }
            },
            before: { value: "empty" },
            after: { value: "accepted" },
            expectedPredicate: { kind: "equals", value: "accepted" }
        });
        const fabricated = deriveScenarioOutcomes([fabricatedFieldWell], binding);
        expect(fabricated.fieldWells?.outcome).not.toBe("passed");
    });

    it("keeps a launch snapshot independent and detects mutation", () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-lens-snapshot-"));
        const source = path.join(temp, "source");
        const snapshot = path.join(temp, "snapshot");
        fs.mkdirSync(source);
        fs.writeFileSync(path.join(source, "AtlynProfileLensSample.pbip"), "fixture");
        fs.cpSync(source, snapshot, { recursive: true });
        const initial = snapshotManifest(snapshot).sha256;
        fs.writeFileSync(path.join(source, "AtlynProfileLensSample.pbip"), "changed source");
        expect(snapshotManifest(snapshot).sha256).toBe(initial);
        fs.writeFileSync(path.join(snapshot, "AtlynProfileLensSample.pbip"), "changed snapshot");
        expect(snapshotManifest(snapshot).sha256).not.toBe(initial);
        const tokenRoot = path.join(temp, "dist", "release", "native-snapshot");
        fs.mkdirSync(tokenRoot, { recursive: true });
        const token = snapshotManifest(source).sha256;
        fs.cpSync(source, path.join(tokenRoot, token), { recursive: true });
        expect(() => verifySnapshot(temp, token, "0".repeat(64))).toThrow(/token and expected/i);
        fs.rmSync(temp, { recursive: true, force: true });
    });

    it("uses OS file sharing to block snapshot writes", () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-lens-lock-"));
        const snapshot = path.join(temp, "dist", "release", "native-snapshot", "a".repeat(64));
        const recovery = path.join(temp, "dist", "release", "native-recovery");
        fs.mkdirSync(snapshot, { recursive: true });
        const file = path.join(snapshot, "locked.pbip");
        fs.writeFileSync(file, "locked");
        const escaped = temp.replaceAll("'", "''");
        const snapshotEscaped = snapshot.replaceAll("'", "''");
        const recoveryEscaped = recovery.replaceAll("'", "''");
        const command = ". 'scripts\\native-validation\\snapshot-guard.ps1'; "
            + `$guard = Open-SnapshotReadLocks -RepoRoot '${escaped}' `
            + `-SnapshotRoot '${snapshotEscaped}' -RecoveryRoot '${recoveryEscaped}' -RunId 'test'; `
            + "try { "
            + `try { [IO.File]::Open('${snapshotEscaped}\\locked.pbip','Open','Write','None').Dispose(); 'writable' } `
            + "catch { 'write-blocked' }; "
            + `try { [IO.File]::WriteAllText('${snapshotEscaped}\\added.txt','x'); 'addition-allowed' } `
            + "catch { 'addition-blocked' } "
            + "} finally { Close-SnapshotReadLocks -Guard $guard }";
        try {
            const output = execFileSync("pwsh", ["-NoProfile", "-Command", command], {
                cwd: root
            }).toString();
            expect(output).toContain("write-blocked");
            expect(output).toContain("addition-blocked");
        } finally {
            fs.rmSync(temp, { recursive: true, force: true });
        }
    });

    it("recovers ACL journals after crash and partial restoration", () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-lens-recovery-"));
        const snapshot = path.join(temp, "dist", "release", "native-snapshot", "b".repeat(64));
        const recovery = path.join(temp, "dist", "release", "native-recovery");
        fs.mkdirSync(path.join(snapshot, "child"), { recursive: true });
        fs.writeFileSync(path.join(snapshot, "child", "file.pbip"), "fixture");
        const command = ". 'scripts\\native-validation\\snapshot-guard.ps1'; "
            + `$guard = Open-SnapshotReadLocks -RepoRoot '${temp.replaceAll("'", "''")}' `
            + `-SnapshotRoot '${snapshot.replaceAll("'", "''")}' `
            + `-RecoveryRoot '${recovery.replaceAll("'", "''")}' -RunId 'crash'; `
            + "foreach($s in $guard.streams){$s.Dispose()}; "
            + "$script:first=$true; $partial={param($p,$a) if($script:first){$script:first=$false;throw 'injected'}else{Set-Acl -Path $p -AclObject $a}}; "
            + "try { Recover-StaleSnapshotAclJournals -RepoRoot $guard.repoRoot "
            + `-RecoveryRoot '${recovery.replaceAll("'", "''")}' -AclWriter $partial; 'unexpected' } `
            + "catch { 'partial-preserved' }; "
            + `if((Get-ChildItem '${recovery.replaceAll("'", "''")}' -Filter '*.json').Count -eq 0){throw 'journal lost'}; `
            + "Recover-StaleSnapshotAclJournals -RepoRoot $guard.repoRoot "
            + `-RecoveryRoot '${recovery.replaceAll("'", "''")}' | Out-Null; `
            + "Recover-StaleSnapshotAclJournals -RepoRoot $guard.repoRoot "
            + `-RecoveryRoot '${recovery.replaceAll("'", "''")}' | Out-Null; 'recovered-idempotent'`;
        try {
            const output = execFileSync("pwsh", ["-NoProfile", "-Command", command], {
                cwd: root
            }).toString();
            expect(output).toContain("partial-preserved");
            expect(output).toContain("recovered-idempotent");
            expect(fs.existsSync(recovery) ? fs.readdirSync(recovery) : []).toHaveLength(0);
        } finally {
            fs.rmSync(temp, { recursive: true, force: true });
        }
    });

    it("cleans an injected owned process failure without masking the original error", () => {
        const marker = path.join(
            fs.mkdtempSync(path.join(os.tmpdir(), "profile-lens-process-")),
            "child.txt"
        );
        const launchScript = path.join(path.dirname(marker), "launch.ps1");
        fs.writeFileSync(
            launchScript,
            `$c=Start-Process pwsh -ArgumentList '-NoProfile','-Command','Start-Sleep 60' -PassThru\n`
                + `Set-Content -Path '${marker.replaceAll("'", "''")}' -Value $c.Id\n`
                + "Start-Sleep 60\n"
        );
        const command = ". 'scripts\\native-validation\\desktop-guard.ps1'; "
            + `$job=Start-OwnedProcessJob -Executable (Get-Command pwsh).Source `
            + `-Argument '${launchScript.replaceAll("'", "''")}' -WorkingDirectory '${path.dirname(marker).replaceAll("'", "''")}'; `
            + `while(-not(Test-Path '${marker.replaceAll("'", "''")}')){Start-Sleep -Milliseconds 100}; `
            + `$childId=[int](Get-Content '${marker.replaceAll("'", "''")}'); `
            + "$primary=[Exception]::new('original-post-launch-failure'); "
            + "$cleanup=Invoke-OwnedProcessCleanup -Job $job; "
            + "$selected=Select-RunFailure -PrimaryFailure $primary -CleanupFailure ([Exception]::new('cleanup')); "
            + "if($cleanup.remaining.Count -ne 0 -or (Get-Process -Id $childId -ErrorAction SilentlyContinue)){throw 'leak'}; $selected.Message";
        try {
            const output = execFileSync("pwsh", ["-NoProfile", "-Command", command], {
                cwd: root
            }).toString();
            expect(output).toContain("original-post-launch-failure");
        } finally {
            fs.rmSync(path.dirname(marker), { recursive: true, force: true });
        }
    });

    it("content-addresses and read-locks the PBIX reopen snapshot", () => {
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-lens-pbix-lock-"));
        const source = path.join(temp, "release.pbix");
        fs.writeFileSync(source, "stable pbix");
        const snapshot = createPbixSnapshot(temp, source);
        fs.writeFileSync(source, "replacement");
        expect(verifyPbixSnapshot(temp, snapshot.token).snapshot.sha256)
            .toBe(snapshot.snapshot.sha256);
        const target = path.join(temp, snapshot.logicalPath);
        const command = ". 'scripts\\native-validation\\snapshot-guard.ps1'; "
            + `$lock=Open-PbixReadLock -Path '${target.replaceAll("'", "''")}'; `
            + "try { "
            + `try {[IO.File]::WriteAllText('${target.replaceAll("'", "''")}','attack');'replaced'}catch{'replace-blocked'}; `
            + `try {[IO.File]::Delete('${target.replaceAll("'", "''")}');'deleted'}catch{'delete-blocked'} `
            + "} finally {$lock.Dispose()}";
        try {
            const output = execFileSync("pwsh", ["-NoProfile", "-Command", command], {
                cwd: root
            }).toString();
            expect(output).toContain("replace-blocked");
            expect(output).toContain("delete-blocked");
            expect(verifyPbixSnapshot(temp, snapshot.token).snapshot.sha256)
                .toBe(snapshot.snapshot.sha256);
        } finally {
            fs.rmSync(temp, { recursive: true, force: true });
        }
    });

    it("requires one exact canonical PBIX resource and an active metadata pointer", async () => {
        const guid = "atlynProfileLens";
        const canonical = `Report/CustomVisuals/${guid}/resources/${guid}.pbiviz.json`;
        expect(requireCanonicalPbixResource([canonical], guid)).toBe(canonical);
        expect(() => requireCanonicalPbixResource([canonical, canonical], guid)).toThrow(/duplicate/i);
        expect(() => requireCanonicalPbixResource([
            `Report/FooCustomVisuals/${guid}/resources/${guid}.pbiviz.json`
        ], guid)).toThrow(/noncanonical|decoy/i);
        const unicodePathOverride = Buffer.alloc(5);
        unicodePathOverride.writeUInt16LE(0x7075, 0);
        unicodePathOverride.writeUInt16LE(1, 2);
        expect(() => parseExtraFields(unicodePathOverride)).toThrow(/Unicode path overrides/i);
        expect(() => requireCanonicalPbixResource([
            `report/CustomVisuals/${guid}/resources/${guid}.pbiviz.json`
        ], guid)).toThrow(/noncanonical|decoy/i);
        expect(() => requireCanonicalPbixResource([
            canonical,
            `Decoy/CustomVisuals/${guid}/resources/${guid}.pbiviz.json`
        ], guid)).toThrow(/noncanonical|decoy/i);

        const packagePath = currentPackagePath;
        const packageZip = await JSZip.loadAsync(fs.readFileSync(packagePath));
        const payload = await packageZip.files[`resources/${guid}.pbiviz.json`]?.async("nodebuffer");
        expect(payload).toBeDefined();
        const temp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-lens-pbix-"));
        async function writePbix(name: string, layout?: string): Promise<string> {
            const Zip = require("jszip") as new () => {
                file(entry: string, value: string | Buffer): unknown;
                generateAsync(options: { type: string }): Promise<Buffer>;
            };
            const zip = new Zip();
            zip.file(canonical, payload as Buffer);
            if (layout !== undefined) zip.file("Report/Layout", layout);
            const target = path.join(temp, name);
            fs.writeFileSync(target, await zip.generateAsync({ type: "nodebuffer" }));
            return target;
        }
        try {
            const activeLayout = JSON.stringify({
                resourcePackages: [{
                    name: guid,
                    type: "CustomVisual",
                    items: [{
                        name: `${guid}.pbiviz.json`,
                        path: `${guid}.pbiviz.json`,
                        type: "CustomVisualMetadata"
                    }]
                }],
                sections: [{
                    visualContainers: [{
                        config: JSON.stringify({ singleVisual: { visualType: guid } })
                    }]
                }]
            });
            const resolved = await verifyPbixVisualParity({
                packagePath,
                pbixPath: await writePbix("resolved.pbix", activeLayout),
                guid
            });
            expect(resolved.presenceParity).toBe(true);
            expect(resolved.activeParity).toBe(true);
            expect(resolved.activePointer.status).toBe("resolved");

            const splitBytes = fs.readFileSync(await writePbix("split.pbix", activeLayout));
            const localSignature = splitBytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
            const localNameLength = splitBytes.readUInt16LE(localSignature + 26);
            expect(localNameLength).toBeGreaterThan(0);
            splitBytes[localSignature + 30] = "X".charCodeAt(0);
            const splitPath = path.join(temp, "split-view.pbix");
            fs.writeFileSync(splitPath, splitBytes);
            await expect(verifyPbixVisualParity({
                packagePath,
                pbixPath: splitPath,
                guid
            })).rejects.toThrow(/local and central records disagree/i);

            const validBytes = fs.readFileSync(await writePbix("unmatched-source.pbix", activeLayout));
            const prefix = Buffer.alloc(30);
            prefix.writeUInt32LE(0x04034b50, 0);
            prefix.writeUInt16LE(20, 4);
            const unmatched = Buffer.concat([prefix, validBytes]);
            let eocd = unmatched.length - 22;
            while (eocd >= 0 && unmatched.readUInt32LE(eocd) !== 0x06054b50) eocd--;
            const entryCount = unmatched.readUInt16LE(eocd + 10);
            const originalCentralStart = unmatched.readUInt32LE(eocd + 16);
            const centralStart = originalCentralStart + prefix.length;
            unmatched.writeUInt32LE(centralStart, eocd + 16);
            let central = centralStart;
            for (let index = 0; index < entryCount; index++) {
                unmatched.writeUInt32LE(
                    unmatched.readUInt32LE(central + 42) + prefix.length,
                    central + 42
                );
                central += 46 + unmatched.readUInt16LE(central + 28)
                    + unmatched.readUInt16LE(central + 30)
                    + unmatched.readUInt16LE(central + 32);
            }
            const unmatchedPath = path.join(temp, "unmatched-local.pbix");
            fs.writeFileSync(unmatchedPath, unmatched);
            await expect(verifyPbixVisualParity({
                packagePath,
                pbixPath: unmatchedPath,
                guid
            })).rejects.toThrow(/unmatched local record|data gap/i);

            const splitDisk = Buffer.from(validBytes);
            let splitDiskEocd = splitDisk.length - 22;
            while (splitDiskEocd >= 0 &&
                splitDisk.readUInt32LE(splitDiskEocd) !== 0x06054b50) splitDiskEocd--;
            const splitDiskCentral = splitDisk.readUInt32LE(splitDiskEocd + 16);
            splitDisk.writeUInt16LE(1, splitDiskCentral + 34);
            const splitDiskPath = path.join(temp, "split-disk.pbix");
            fs.writeFileSync(splitDiskPath, splitDisk);
            await expect(verifyPbixVisualParity({
                packagePath,
                pbixPath: splitDiskPath,
                guid
            })).rejects.toThrow(/split-disk/i);

            const missing = await verifyPbixVisualParity({
                packagePath,
                pbixPath: await writePbix("missing.pbix"),
                guid
            });
            expect(missing.presenceParity).toBe(true);
            expect(missing.activeParity).toBe(false);
            expect(missing.activePointer.status).toBe("unavailable");

            const wrong = await verifyPbixVisualParity({
                packagePath,
                pbixPath: await writePbix("wrong.pbix", JSON.stringify({
                    resourcePackages: [{
                        name: guid,
                        type: "CustomVisual",
                        items: [{ name: "wrong", path: "wrong", type: "CustomVisualMetadata" }]
                    }],
                    sections: []
                })),
                guid
            });
            expect(wrong.activeParity).toBe(false);
            expect(wrong.activePointer.status).toBe("wrong-or-missing");
        } finally {
            fs.rmSync(temp, { recursive: true, force: true });
        }
    });
});
