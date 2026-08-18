const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const writeFileAtomic = require("write-file-atomic");
const {
    assertBoundSourceMatchesCommit,
    computeAutomationIntegrity
} = require("./native-source-integrity.cjs");
const { assertEvidenceSafe } = require("./native-evidence-sanitize.cjs");
const { verifyPbixVisualParity } = require("./sample-resource-parity.cjs");
const { deriveScenarioOutcomes } = require("./native-observations.cjs");
const { verifySnapshot } = require("./native-snapshot.cjs");
const { verifyPbixSnapshot } = require("./native-pbix-snapshot.cjs");
const { acquirePbixPublicationLock } = require("./pbix-publication-lock.cjs");

const REQUIRED_SCENARIOS = [
    "fieldWells",
    "profilesAndNormalization",
    "contextModesAndJoins",
    "selectionAndContextMenus",
    "tooltipsAndKeyboard",
    "lifecycleAndStaticSurfaces",
    "pbixOfflineReopen"
];

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function finalizeNativeEvidence(root) {
    const source = path.join(root, "dist", "release", "native-evidence", "native-run.json");
    const visualManifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    const packagePath = path.join(
        root,
        "dist",
        `${visualManifest.visual.name}.${visualManifest.visual.version}.pbiviz`
    );
    const pbixPath = path.join(
        root,
        "dist",
        "release",
        `AtlynProfileLensSample-${visualManifest.visual.version}.pbix`
    );
    const target = path.join(
        root,
        "docs",
        "native-validation",
        `${visualManifest.visual.name}-${visualManifest.visual.version}.json`
    );
    const previousTarget = fs.existsSync(target) ? fs.readFileSync(target) : null;
    const publicationLock = await acquirePbixPublicationLock(root, pbixPath);
    try {
    const run = JSON.parse(fs.readFileSync(source, "utf8"));
    assertEvidenceSafe(run, [process.env.USERNAME, process.env.USER]);
    if (run.outcome !== "native-run-completed") {
        throw new Error("The native runner did not complete.");
    }
    if (run.cleanup?.allExited !== true || run.guardsRestored !== true) {
        throw new Error("Owned-process cleanup or snapshot-guard restoration is incomplete.");
    }
    const snapshot = verifySnapshot(
        root,
        run.snapshot?.token,
        run.snapshot?.manifest?.sha256
    );
    if (JSON.stringify(run.snapshot?.manifest) !== JSON.stringify(snapshot.manifest)) {
        throw new Error("Recorded snapshot manifest differs from the exact verified snapshot.");
    }
    if (run.snapshot?.lock?.mode !==
            "controlled-run-file-read-locks-and-phase-manifests" ||
        run.snapshot?.lock?.writesAndDeletesDeniedForExpectedFiles !== true ||
        run.snapshot?.lock?.directoryAdditionsRequirePhaseDetection !== true ||
        run.snapshot?.lock?.adversarialSameUserImmutability !== false ||
        run.snapshot?.lock?.lockedFiles !== snapshot.manifest.files ||
        !/^[0-9a-f]{32}$/.test(run.runId ?? "")) {
        throw new Error("Snapshot lock evidence is incomplete.");
    }
    const nativeScenarios = deriveScenarioOutcomes(run.observations, {
        sourceCommit: run.sourceCommit,
        snapshotSha256: snapshot.manifest.sha256
    });
    for (const scenario of REQUIRED_SCENARIOS) {
        if (nativeScenarios[scenario]?.outcome !== "passed") {
            throw new Error(`Required native scenario is not proven: ${scenario}`);
        }
    }
    assertBoundSourceMatchesCommit(root, run.sourceCommit);
    const automation = computeAutomationIntegrity(root);
    if (run.automation?.sha256 !== automation.sha256) {
        throw new Error("Native automation differs from the completed run.");
    }
    const pbixSnapshot = verifyPbixSnapshot(root, run.pbixSnapshot?.token);
    if (pbixSnapshot.snapshot.sha256 !== run.pbixSnapshot?.snapshot?.sha256 ||
        pbixSnapshot.snapshot.sha256 !== run.pbixSnapshot?.original?.sha256) {
        throw new Error("PBIX snapshot does not match the stable release PBIX.");
    }
    if (run.pbixTitleGuard?.basename !== path.parse(pbixSnapshot.basename).name ||
        run.pbixTitleGuard?.snapshotSha256 !== pbixSnapshot.token ||
    run.pbixTitleGuard?.runId !== run.runId) {
        throw new Error("PBIX title ownership guard is not bound to the snapshot and run.");
    }
    const pbixSnapshotPath = path.join(root, pbixSnapshot.logicalPath);
    const pbixParity = await verifyPbixVisualParity({
        packagePath,
        pbixPath: pbixSnapshotPath,
        guid: visualManifest.visual.guid
    });
    if (pbixParity.activeParity !== true) {
        throw new Error(
            "PBIX contains the payload, but the active report resource pointer was not resolved."
        );
    }
    const pbixObservation = (run.observations ?? []).find(
        (observation) => observation.id === "pbix-offline-reopen"
    );
    if (run.pbixBeforeReopen?.sha256 !== pbixParity.pbix.sha256 ||
        run.pbixAfterReopen?.sha256 !== pbixParity.pbix.sha256 ||
        pbixObservation?.before?.sha256 !== pbixParity.pbix.sha256 ||
        pbixObservation?.after?.sha256 !== pbixParity.pbix.sha256 ||
        run.pbixBeforeReopen?.bytes !== pbixParity.pbix.bytes ||
        run.pbixAfterReopen?.bytes !== pbixParity.pbix.bytes) {
        throw new Error("PBIX reopen hashes do not match the final PBIX.");
    }
    const packageBytes = fs.readFileSync(packagePath);
    const evidence = {
        schemaVersion: 1,
        outcome: "validated",
        sourceCommit: run.sourceCommit,
        visual: {
            guid: visualManifest.visual.guid,
            version: visualManifest.visual.version,
            apiVersion: visualManifest.apiVersion
        },
        desktopVersion: run.desktop,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        automation,
        pbiviz: {
            path: `dist/${path.basename(packagePath)}`,
            bytes: packageBytes.length,
            sha256: sha256(packageBytes)
        },
        sample: run.sample,
        snapshot: {
            ...run.snapshot,
            manifest: snapshot.manifest
        },
        observations: run.observations,
        pbix: {
            path: `dist/release/${path.basename(pbixPath)}`,
            bytes: pbixParity.pbix.bytes,
            sha256: pbixParity.pbix.sha256,
            stableAcrossReopen: true,
            embeddedVisualParity: true,
            parity: pbixParity
        },
        pbixSnapshot: run.pbixSnapshot,
        nativeScenarios,
        boundaries: run.boundaries ?? []
    };
    assertEvidenceSafe(evidence, [process.env.USERNAME, process.env.USER]);
    const releasePbixBytes = fs.readFileSync(pbixPath);
    if (releasePbixBytes.length !== pbixSnapshot.snapshot.bytes ||
        sha256(releasePbixBytes) !== pbixSnapshot.token) {
        throw new Error("Release PBIX changed before evidence publication.");
    }
    await publicationLock.verifyAlive();
    writeFileAtomic.sync(target, `${JSON.stringify(evidence, null, 2)}\n`);
    try {
        await publicationLock.verifyAlive();
    } catch (error) {
        if (previousTarget) writeFileAtomic.sync(target, previousTarget);
        else fs.rmSync(target, { force: true });
        throw error;
    }
    return target;
    } finally {
        await publicationLock.release().catch(() => {});
    }
}

module.exports = { REQUIRED_SCENARIOS, finalizeNativeEvidence };

if (require.main === module) {
    const root = path.resolve(__dirname, "..");
    finalizeNativeEvidence(root).then((target) => {
        console.log(`Finalized native evidence at ${path.relative(root, target)}`);
    }).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
