const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
    assertBoundSourceMatchesCommit,
    computeAutomationIntegrity
} = require("./native-source-integrity.cjs");
const { assertEvidenceSafe } = require("./native-evidence-sanitize.cjs");
const { verifyPbixVisualParity } = require("./sample-resource-parity.cjs");
const { deriveScenarioOutcomes } = require("./native-observations.cjs");
const { verifySnapshot } = require("./native-snapshot.cjs");

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
    const run = JSON.parse(fs.readFileSync(source, "utf8"));
    assertEvidenceSafe(run, [process.env.USERNAME, process.env.USER]);
    if (run.outcome !== "native-run-completed") {
        throw new Error("The native runner did not complete.");
    }
    const snapshot = verifySnapshot(
        root,
        run.snapshot?.token,
        run.snapshot?.manifest?.sha256
    );
    if (run.snapshot?.lock?.mode !== "os-file-share-and-directory-deny-acl" ||
        run.snapshot?.lock?.writesDeletesAndAdditionsDenied !== true ||
        run.snapshot?.lock?.lockedFiles !== snapshot.manifest.files ||
        !(run.snapshot?.lock?.guardedDirectories > 0)) {
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
    const pbixParity = await verifyPbixVisualParity({
        packagePath,
        pbixPath,
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
        snapshot: run.snapshot,
        observations: run.observations,
        pbix: {
            path: `dist/release/${path.basename(pbixPath)}`,
            bytes: pbixParity.pbix.bytes,
            sha256: pbixParity.pbix.sha256,
            stableAcrossReopen: true,
            embeddedVisualParity: true,
            parity: pbixParity
        },
        nativeScenarios,
        boundaries: run.boundaries ?? []
    };
    assertEvidenceSafe(evidence, [process.env.USERNAME, process.env.USER]);
    const target = path.join(
        root,
        "docs",
        "native-validation",
        `${visualManifest.visual.name}-${visualManifest.visual.version}.json`
    );
    fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`);
    return target;
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
