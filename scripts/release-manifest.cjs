/**
 * Writes the immutable release manifest for the generated package.
 *
 * The manifest records the exact artifact hash, the assets, the sample project, and the hash policy
 * that makes the hash reproducible, so a submission can be tied back to a specific source commit.
 *
 * Usage: node scripts/release-manifest.cjs
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const writeFileAtomic = require("write-file-atomic");
const { portablePath } = require("./portable-path.cjs");
const { computeSampleIntegrity } = require("./sample-integrity.cjs");
const {
    assertBoundSourceMatchesCommit,
    computeAutomationIntegrity
} = require("./native-source-integrity.cjs");
const { REQUIRED_SCENARIOS } = require("./finalize-native-evidence.cjs");

const root = path.resolve(__dirname, "..");
const packageDirectory = path.join(root, "dist");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const expectedName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;

const packages = fs.existsSync(packageDirectory)
    ? fs.readdirSync(packageDirectory).filter((entry) => entry.endsWith(".pbiviz"))
    : [];
if (packages.length !== 1) {
    throw new Error("Release manifest requires exactly one PBIVIZ file in dist.");
}
if (packages[0] !== expectedName) {
    throw new Error(`Release manifest package filename must be ${expectedName}.`);
}

const packagePath = path.join(packageDirectory, expectedName);
const packageBuffer = fs.readFileSync(packagePath);
const nativeEvidenceRelativePath = path.join(
    "docs",
    "native-validation",
    `${manifest.visual.name}-${manifest.visual.version}.json`
);
const nativeEvidencePath = path.join(root, nativeEvidenceRelativePath);
const nativeEvidence = fs.existsSync(nativeEvidencePath)
    ? JSON.parse(fs.readFileSync(nativeEvidencePath, "utf8"))
    : null;
const pbixRelativePath = path.join(
    "dist",
    "release",
    `AtlynProfileLensSample-${manifest.visual.version}.pbix`
);
const pbixMetadata = fileMetadata(pbixRelativePath);
const runtimeLicenseSource = fs.readFileSync(
    path.join(root, "src", "runtimeLicenses.ts"),
    "utf8"
);
const runtimeLicenseText = runtimeLicenseSource.match(
    /export const RUNTIME_LICENSE_NOTICES = `([\s\S]*?)`;/
)?.[1];
if (!runtimeLicenseText) {
    throw new Error("Release manifest requires canonical runtime license notices.");
}

function fileMetadata(relativePath) {
    const filePath = path.join(root, relativePath);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const bytes = fs.readFileSync(filePath);
    return {
        path: portablePath(relativePath),
        bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    };
}

function walk(relativeDirectory, sink) {
    const absolute = path.join(root, relativeDirectory);
    if (!fs.existsSync(absolute)) {
        return;
    }
    for (const entry of fs.readdirSync(absolute).sort()) {
        const next = path.join(relativeDirectory, entry);
        if (fs.statSync(path.join(root, next)).isDirectory()) {
            walk(next, sink);
        } else {
            sink.push(fileMetadata(next));
        }
    }
}

const sampleRoot = path.join("samples", "AtlynProfileLensSample");
const sampleFiles = [];
walk(sampleRoot, sampleFiles);
const sampleIntegrityPath = path.join(sampleRoot, "sample-integrity.json");
const recordedSampleIntegrity = JSON.parse(
    fs.readFileSync(path.join(root, sampleIntegrityPath), "utf8")
);
const computedSampleIntegrity = computeSampleIntegrity({
    root,
    sampleRoot: path.join(root, sampleRoot),
    generatorPath: path.join(root, "scripts", "build-sample-report.cjs"),
    guid: manifest.visual.guid
});
const sampleResourceParity = JSON.parse(execFileSync(
    process.execPath,
    [path.join(root, "scripts", "sample-resource-parity.cjs")],
    { cwd: root, encoding: "utf8" }
));
const automationIntegrity = computeAutomationIntegrity(root);
const cleanReleaseSourceCommit = require("./native-source-integrity.cjs")
    .assertCleanBoundSource(root);
if (JSON.stringify(recordedSampleIntegrity) !== JSON.stringify(computedSampleIntegrity)) {
    throw new Error('Sample integrity is stale; run "npm run sample:pbip" after package generation.');
}
const packRoot = path.join("src", "context", "packs", "generated");
const contextPacks = fs.existsSync(path.join(root, packRoot))
    ? fs.readdirSync(path.join(root, packRoot))
        .filter((entry) => entry.endsWith(".pack.json"))
        .sort()
        .map((entry) => {
            const relativePath = path.join(packRoot, entry);
            const metadata = fileMetadata(relativePath);
            const artifact = JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
            return {
                ...metadata,
                id: artifact.manifest.id,
                vintage: artifact.manifest.vintage,
                detail: artifact.manifest.detail,
                featureCount: artifact.manifest.featureCount,
                sourceArchiveSha256: artifact.manifest.sourceArchiveSha256,
                payloadSha256: artifact.manifest.artifactSha256,
                policyId: artifact.manifest.policyId
            };
        })
    : [];

let sourceCommit = "unknown";
try {
    sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
} catch {
    sourceCommit = "unknown";
}

const packageSha256 = crypto.createHash("sha256").update(packageBuffer).digest("hex");
if (sourceCommit !== cleanReleaseSourceCommit) {
    throw new Error("Release source commit changed during manifest generation.");
}
if (sampleResourceParity.package.sha256 !== packageSha256 ||
    crypto.createHash("sha256").update(fs.readFileSync(packagePath)).digest("hex") !== packageSha256) {
    throw new Error("PBIVIZ changed while sample resource parity was being verified.");
}
const nativeValidated = nativeEvidence?.outcome === "validated";
const pbixResourceParity = nativeValidated && pbixMetadata
    ? JSON.parse(execFileSync(
        process.execPath,
        [path.join(root, "scripts", "sample-resource-parity.cjs"), "--pbix",
            path.join(root, pbixRelativePath)],
        { cwd: root, encoding: "utf8" }
    ))
    : null;
if (nativeValidated) {
    const mismatches = [];
    for (const scenario of REQUIRED_SCENARIOS) {
        if (nativeEvidence.nativeScenarios?.[scenario]?.outcome !== "passed") {
            mismatches.push(`native scenario ${scenario}`);
        }
    }
    try {
        assertBoundSourceMatchesCommit(root, nativeEvidence.sourceCommit);
    } catch {
        mismatches.push("package, fixture, or automation source tree");
    }
    if (nativeEvidence.visual?.guid !== manifest.visual.guid) mismatches.push("visual GUID");
    if (nativeEvidence.visual?.version !== manifest.visual.version) mismatches.push("visual version");
    if (nativeEvidence.visual?.apiVersion !== manifest.apiVersion) mismatches.push("API version");
    if (nativeEvidence.pbiviz?.sha256 !== packageSha256) mismatches.push("PBIVIZ SHA-256");
    if (nativeEvidence.automation?.sha256 !== automationIntegrity.sha256) {
        mismatches.push("native automation tree");
    }
    for (const [label, actual, expected] of [
        ["sample project tree", nativeEvidence.sample?.projectTreeSha256,
            computedSampleIntegrity.projectTree.sha256],
        ["sample report definition", nativeEvidence.sample?.reportDefinitionTreeSha256,
            computedSampleIntegrity.reportDefinitionTree.sha256],
        ["sample model definition", nativeEvidence.sample?.modelDefinitionTreeSha256,
            computedSampleIntegrity.modelDefinitionTree.sha256],
        ["sample generator", nativeEvidence.sample?.generatorSha256,
            computedSampleIntegrity.generator.sha256],
        ["sample PBIP", nativeEvidence.sample?.pbipSha256,
            computedSampleIntegrity.pbip.sha256],
        ["sample embedded visual", nativeEvidence.sample?.embeddedVisualResourceSha256,
            computedSampleIntegrity.embeddedVisualResource.sha256]
    ]) {
        if (actual !== expected) mismatches.push(label);
    }
    if (JSON.stringify(nativeEvidence.sample?.resourceParity) !==
        JSON.stringify(sampleResourceParity)) {
        mismatches.push("PBIVIZ to sample resource parity");
    }
    if (!pbixMetadata) mismatches.push("PBIX file");
    if (nativeEvidence.pbix?.sha256 !== pbixMetadata?.sha256) mismatches.push("PBIX SHA-256");
    if (nativeEvidence.pbix?.bytes !== pbixMetadata?.bytes) mismatches.push("PBIX byte length");
    if (nativeEvidence.pbix?.embeddedVisualParity !== true) {
        mismatches.push("PBIX embedded visual parity");
    }
    if (nativeEvidence.pbix?.stableAcrossReopen !== true) {
        mismatches.push("PBIX reopen byte stability");
    }
    if (JSON.stringify(nativeEvidence.pbix?.parity) !== JSON.stringify(pbixResourceParity)) {
        mismatches.push("PBIX embedded resource parity");
    }
    if (mismatches.length > 0) {
        throw new Error(
            `Validated native evidence does not match this release: ${mismatches.join(", ")}.`
        );
    }
}

const releaseManifest = {
    schemaVersion: 1,
    sourceCommit,
    visual: {
        guid: manifest.visual.guid,
        name: manifest.visual.name,
        displayName: manifest.visual.displayName,
        version: manifest.visual.version,
        apiVersion: manifest.apiVersion
    },
    submission: {
        supportUrl: manifest.visual.supportUrl,
        gitHubUrl: manifest.visual.gitHubUrl,
        authorName: manifest.author.name,
        authorEmail: manifest.author.email,
        license: packageJson.license,
        appSourceListing: "Free",
        sampleReport: {
            path: portablePath(sampleRoot),
            format: "PBIP",
            files: sampleFiles.filter(Boolean).length,
            integrity: {
                manifest: fileMetadata(sampleIntegrityPath),
                ...computedSampleIntegrity
            },
            resourceParity: sampleResourceParity,
            pbix: pbixMetadata,
            pbixStatus: pbixMetadata && nativeValidated
                ? "A genuine Desktop-produced PBIX is present and tied to the native evidence record."
                : "Blocked for submission: no validated native PBIX is claimed. Create it from this PBIP in Power BI Desktop, close and reopen it, prove embedded visual parity and stable bytes, and complete native validation before submission."
        }
    },
    package: {
        filename: expectedName,
        bytes: packageBuffer.length,
        sha256: packageSha256
    },
    assets: {
        visualIcon: fileMetadata(manifest.assets.icon),
        partnerCenterLogo300x300: fileMetadata(path.join("assets", "partner-center-logo-300x300.png"))
    },
    licenses: {
        thirdPartyNotices: fileMetadata("THIRD_PARTY_NOTICES.md"),
        packagedRuntimeMarkers: [
            "RUNTIME-LICENSE-NOTICES-BEGIN",
            "RUNTIME-LICENSE-NOTICES-END"
        ],
        runtimeNoticeSha256: crypto
            .createHash("sha256")
            .update(runtimeLicenseText.replace(/\r\n/g, "\n"))
            .digest("hex")
    },
    contextPacks,
    nativeValidation: nativeEvidence
        ? {
            outcome: nativeEvidence.outcome,
            evidence: fileMetadata(nativeEvidenceRelativePath),
            desktopVersion: nativeEvidence.desktopVersion,
            startedAt: nativeEvidence.startedAt,
            completedAt: nativeEvidence.completedAt,
            pbivizSha256: nativeEvidence.pbiviz?.sha256 ?? null,
            pbixSha256: nativeEvidence.pbix?.sha256 ?? null,
            sample: nativeEvidence.sample ?? null,
            boundaries: nativeEvidence.boundaries ?? []
        }
        : {
            outcome: "not-run",
            evidence: null
        },
    nativeAutomation: automationIntegrity,
    contract: {
        dataViewMappings: 1,
        mappingKind: "matrix",
        interactionModes: ["localOnly", "reportSelection"],
        outwardFilter: false,
        roles: (JSON.parse(fs.readFileSync(path.join(root, "capabilities.json"), "utf8")).dataRoles ?? [])
            .map((role) => role.name)
    },
    hashPolicy: "PBIVIZ ZIP entries are sorted and normalized to a fixed UTC anchored DOS timestamp, DEFLATE level 9, and DOS platform metadata before hashing, so the hash does not depend on the build machine's timezone or platform.",
    proofBoundary: "Automated unit, pack-pipeline and packaged-browser probes prove strict bounded parsing, exact offline world/state/county joins, deterministic source hashes and generated packs, complete declared territory coverage, point/grid/hex/bound-geometry providers, SVG/Canvas semantic and host-identity parity, physical hit testing, bounded Canvas surfaces, responsive layout through 80x80, disabled physical focus, high contrast, RTL, reduced motion and runtime network abstinence. Native Desktop/Service field wells, segmentation, bookmarks, DirectQuery/Direct Lake, export, pinning, native tooltip rendering and matrix expand/collapse remain unproven unless the nativeValidation record explicitly reports a validated observation. expandCollapse and drilldown are intentionally undeclared. This manifest never treats PBIP structure or a blocked Desktop launch as PBIX validation, Microsoft certification, or Partner Center submission."
};

const finalSourceCommit = require("./native-source-integrity.cjs").assertCleanBoundSource(root);
const finalAutomationIntegrity = computeAutomationIntegrity(root);
const finalSampleIntegrity = computeSampleIntegrity({
    root,
    sampleRoot: path.join(root, sampleRoot),
    generatorPath: path.join(root, "scripts", "build-sample-report.cjs"),
    guid: manifest.visual.guid
});
const finalSampleResourceParity = JSON.parse(execFileSync(
    process.execPath,
    [path.join(root, "scripts", "sample-resource-parity.cjs")],
    { cwd: root, encoding: "utf8" }
));
const finalPackageSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(packagePath))
    .digest("hex");
const finalPbixMetadata = fileMetadata(pbixRelativePath);
const finalPbixResourceParity = nativeValidated && finalPbixMetadata
    ? JSON.parse(execFileSync(
        process.execPath,
        [path.join(root, "scripts", "sample-resource-parity.cjs"), "--pbix",
            path.join(root, pbixRelativePath)],
        { cwd: root, encoding: "utf8" }
    ))
    : null;
if (finalSourceCommit !== sourceCommit ||
    JSON.stringify(finalAutomationIntegrity) !== JSON.stringify(automationIntegrity) ||
    JSON.stringify(finalSampleIntegrity) !== JSON.stringify(computedSampleIntegrity) ||
    JSON.stringify(finalSampleResourceParity) !== JSON.stringify(sampleResourceParity) ||
    JSON.stringify(finalPbixMetadata) !== JSON.stringify(pbixMetadata) ||
    JSON.stringify(finalPbixResourceParity) !== JSON.stringify(pbixResourceParity) ||
    finalPackageSha256 !== packageSha256) {
    throw new Error("Release inputs changed before manifest publication.");
}

writeFileAtomic.sync(
    path.join(packageDirectory, "release-manifest.json"),
    `${JSON.stringify(releaseManifest, null, 2)}\n`
);
console.log(`Release manifest written for ${expectedName} at ${releaseManifest.package.sha256}`);
