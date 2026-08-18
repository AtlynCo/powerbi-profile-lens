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
const { portablePath } = require("./portable-path.cjs");

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
            pbixStatus: "Blocked for submission: no .pbix is produced or claimed. Before Partner Center submission, create a native offline PBIX from this PBIP in Power BI Desktop, embed this exact PBIVIZ hash, close and reopen it, complete native validation, and add it to the submission materials."
        }
    },
    package: {
        filename: expectedName,
        bytes: packageBuffer.length,
        sha256: crypto.createHash("sha256").update(packageBuffer).digest("hex")
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
    contract: {
        dataViewMappings: 1,
        mappingKind: "matrix",
        interactionModes: ["localOnly", "reportSelection"],
        outwardFilter: false,
        roles: (JSON.parse(fs.readFileSync(path.join(root, "capabilities.json"), "utf8")).dataRoles ?? [])
            .map((role) => role.name)
    },
    hashPolicy: "PBIVIZ ZIP entries are sorted and normalized to a fixed UTC anchored DOS timestamp, DEFLATE level 9, and DOS platform metadata before hashing, so the hash does not depend on the build machine's timezone or platform.",
    proofBoundary: "Automated unit, pack-pipeline and packaged-browser probes prove strict bounded parsing, exact offline world/state/county joins, deterministic source hashes and generated packs, complete declared territory coverage, point/grid/hex/bound-geometry providers, SVG/Canvas semantic and host-identity parity, physical hit testing, bounded Canvas surfaces, responsive layout through 80x80, disabled physical focus, high contrast, RTL, reduced motion and runtime network abstinence. Native Desktop/Service field wells, segmentation, bookmarks, DirectQuery/Direct Lake, export, pinning, native tooltip rendering and matrix expand/collapse remain unproven. expandCollapse and drilldown are intentionally undeclared. This artifact is not Partner Center submission-ready or certification-complete: a native offline PBIX embedding the exact PBIVIZ hash must be created in Desktop, closed, reopened, validated, and added before submission."
};

fs.writeFileSync(
    path.join(packageDirectory, "release-manifest.json"),
    `${JSON.stringify(releaseManifest, null, 2)}\n`
);
console.log(`Release manifest written for ${expectedName} at ${releaseManifest.package.sha256}`);
