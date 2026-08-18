const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function metadata(filePath) {
    const bytes = fs.readFileSync(filePath);
    return {
        bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    };
}

function createPbixSnapshot(root, sourcePath) {
    const source = metadata(sourcePath);
    const parent = path.join(root, "dist", "release", "native-pbix-snapshot");
    const target = path.join(parent, `${source.sha256}.pbix`);
    const staging = `${target}.staging`;
    fs.mkdirSync(parent, { recursive: true });
    fs.rmSync(staging, { force: true });
    fs.copyFileSync(sourcePath, staging, fs.constants.COPYFILE_EXCL);
    const copied = metadata(staging);
    if (JSON.stringify(copied) !== JSON.stringify(source)) {
        fs.rmSync(staging, { force: true });
        throw new Error("PBIX snapshot differs from the stable Desktop output.");
    }
    fs.rmSync(target, { force: true });
    fs.renameSync(staging, target);
    return {
        token: source.sha256,
        logicalPath: `dist/release/native-pbix-snapshot/${source.sha256}.pbix`,
        original: source,
        snapshot: copied
    };
}

function verifyPbixSnapshot(root, token) {
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("PBIX snapshot token is invalid.");
    const logicalPath = `dist/release/native-pbix-snapshot/${token}.pbix`;
    const snapshot = metadata(path.join(root, logicalPath));
    if (snapshot.sha256 !== token) throw new Error("PBIX snapshot changed.");
    return { token, logicalPath, snapshot };
}

module.exports = { createPbixSnapshot, metadata, verifyPbixSnapshot };

if (require.main === module) {
    const root = path.resolve(__dirname, "..");
    const result = process.argv[2] === "--verify"
        ? verifyPbixSnapshot(root, process.argv[3])
        : createPbixSnapshot(root, path.resolve(process.argv[2]));
    process.stdout.write(JSON.stringify(result));
}
