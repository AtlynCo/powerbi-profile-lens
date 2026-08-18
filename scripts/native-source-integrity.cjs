const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const AUTOMATION_PATHS = [
    "scripts/native-validation",
    "scripts/native-evidence-sanitize.cjs",
    "scripts/native-observations.cjs",
    "scripts/native-pbix-snapshot.cjs",
    "scripts/pbix-publication-lock.cjs",
    "scripts/native-snapshot.cjs",
    "scripts/native-source-integrity.cjs",
    "scripts/finalize-native-evidence.cjs",
    "scripts/sample-integrity.cjs",
    "scripts/sample-resource-parity.cjs"
];

const BOUND_PATHS = [
    "package.json",
    "package-lock.json",
    "pbiviz.json",
    "capabilities.json",
    "assets/icon.png",
    "src",
    "style",
    "stringResources",
    "scripts",
    "docs/native-validation",
    "samples/AtlynProfileLensSample",
];
const HISTORICAL_BOUND_PATHS = BOUND_PATHS.filter(
    (relativePath) => relativePath !== "docs/native-validation"
);

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sourceFiles(root, relativePaths) {
    const files = [];
    function add(relativePath) {
        const absolute = path.join(root, relativePath);
        if (!fs.existsSync(absolute)) {
            throw new Error(`Bound source path is missing: ${relativePath}`);
        }
        if (fs.statSync(absolute).isDirectory()) {
            for (const entry of fs.readdirSync(absolute).sort()) {
                add(path.join(relativePath, entry));
            }
            return;
        }
        const raw = fs.readFileSync(absolute);
        const bytes = Buffer.from(raw.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
        files.push({
            path: relativePath.split(path.sep).join("/"),
            bytes: bytes.length,
            sha256: sha256(bytes)
        });
    }
    for (const relativePath of relativePaths) add(relativePath);
    return files;
}

function canonicalTree(files) {
    return sha256(Buffer.from(
        files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(""),
        "utf8"
    ));
}

function computeAutomationIntegrity(root) {
    const files = sourceFiles(root, AUTOMATION_PATHS);
    return {
        paths: AUTOMATION_PATHS,
        files: files.length,
        sha256: canonicalTree(files)
    };
}

function assertCleanBoundSource(root, sourceCommit = null) {
    const status = execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=all", "--", ...BOUND_PATHS],
        { cwd: root, encoding: "utf8" }
    ).trim();
    if (status) throw new Error("Bound package, fixture, or automation source is dirty.");
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8"
    }).trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Source commit is invalid.");
    if (sourceCommit && commit !== sourceCommit) throw new Error("Source commit changed.");
    return commit;
}

function assertBoundSourceMatchesCommit(root, sourceCommit) {
    if (!/^[0-9a-f]{40}$/.test(sourceCommit)) {
        throw new Error("Evidence source commit must be a full immutable SHA.");
    }
    const resolved = execFileSync("git", ["rev-parse", `${sourceCommit}^{commit}`], {
        cwd: root,
        encoding: "utf8"
    }).trim();
    if (resolved !== sourceCommit) throw new Error("Evidence source commit did not resolve exactly.");
    execFileSync("git", ["diff", "--quiet", sourceCommit, "--", ...HISTORICAL_BOUND_PATHS], {
        cwd: root,
        stdio: "ignore"
    });
    assertCleanBoundSource(root);
}

module.exports = {
    AUTOMATION_PATHS,
    BOUND_PATHS,
    HISTORICAL_BOUND_PATHS,
    assertBoundSourceMatchesCommit,
    assertCleanBoundSource,
    computeAutomationIntegrity
};

if (require.main === module) {
    const root = path.resolve(__dirname, "..");
    const sourceCommit = assertCleanBoundSource(root);
    process.stdout.write(JSON.stringify({
        sourceCommit,
        automation: computeAutomationIntegrity(root)
    }));
}
