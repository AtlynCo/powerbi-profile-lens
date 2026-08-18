const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function manifest(directory, excluded = new Set()) {
    const files = [];
    function walk(current) {
        for (const entry of fs.readdirSync(current).sort()) {
            const absolute = path.join(current, entry);
            if (fs.statSync(absolute).isDirectory()) {
                walk(absolute);
                continue;
            }
            const bytes = fs.readFileSync(absolute);
            const relativePath = path.relative(directory, absolute).split(path.sep).join("/");
            if (excluded.has(relativePath)) continue;
            files.push({
                path: relativePath,
                bytes: bytes.length,
                sha256: sha256(bytes)
            });
        }
    }
    walk(directory);
    const canonical = files.map(
        (file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`
    ).join("");
    return {
        files: files.length,
        bytes: files.reduce((total, file) => total + file.bytes, 0),
        sha256: sha256(Buffer.from(canonical, "utf8")),
        entries: files
    };
}

function createSnapshot(root) {
    const source = path.join(root, "samples", "AtlynProfileLensSample");
    const sourceManifest = manifest(source);
    const fixtureProjectTree = manifest(source, new Set(["sample-integrity.json"]));
    const token = sourceManifest.sha256;
    const parent = path.join(root, "dist", "release", "native-snapshot");
    const destination = path.join(parent, token);
    const staging = path.join(parent, `${token}.staging`);
    fs.mkdirSync(parent, { recursive: true });
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(source, staging, { recursive: true, force: false });
    const copied = manifest(staging);
    if (JSON.stringify(copied) !== JSON.stringify(sourceManifest)) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw new Error("Native snapshot copy differs from the verified PBIP source.");
    }
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(staging, destination);
    return {
        token,
        logicalPath: `dist/release/native-snapshot/${token}`,
        pbip: "AtlynProfileLensSample.pbip",
        manifest: copied,
        fixtureProjectTreeSha256: fixtureProjectTree.sha256
    };
}

function verifySnapshot(root, token, expectedSha256 = token) {
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Snapshot token is invalid.");
    if (expectedSha256 !== token) throw new Error("Snapshot token and expected hash differ.");
    const directory = path.join(root, "dist", "release", "native-snapshot", token);
    const current = manifest(directory);
    if (current.sha256 !== token) throw new Error("Native snapshot changed.");
    return {
        token,
        logicalPath: `dist/release/native-snapshot/${token}`,
        pbip: "AtlynProfileLensSample.pbip",
        manifest: current,
        fixtureProjectTreeSha256: manifest(
            directory,
            new Set(["sample-integrity.json"])
        ).sha256
    };
}

module.exports = { createSnapshot, manifest, verifySnapshot };

if (require.main === module) {
    const root = path.resolve(__dirname, "..");
    const result = process.argv[2] === "--verify"
        ? verifySnapshot(root, process.argv[3], process.argv[4])
        : createSnapshot(root);
    process.stdout.write(JSON.stringify(result));
}
