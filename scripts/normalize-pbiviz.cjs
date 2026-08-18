/**
 * Normalizes the generated .pbiviz so its bytes, and therefore its hash, depend only on content.
 *
 * JSZip encodes ZIP timestamps with the Date's UTC getters, so the anchor must be built in UTC:
 * `new Date(1980, 0, 1)` is local midnight and encodes a different DOS time on every build machine.
 *
 * Usage: node scripts/normalize-pbiviz.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");
const writeFileAtomic = require("write-file-atomic");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const packageDirectory = path.join(root, "dist");
const packageName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;
const packagePath = path.join(packageDirectory, packageName);
const fixedDate = new Date(Date.UTC(1980, 0, 1, 0, 0, 0, 0));

function assert(condition, message) {
    if (!condition) {
        throw new Error(`PBIVIZ normalization failed: ${message}`);
    }
}

function assertRawUniqueNames(bytes) {
        let eocd = -1;
        for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
            if (bytes.readUInt32LE(offset) === 0x06054b50) {
                eocd = offset;
                break;
            }
        }
        assert(eocd >= 0, "source ZIP has no EOCD");
        const entries = bytes.readUInt16LE(eocd + 10);
        const centralSize = bytes.readUInt32LE(eocd + 12);
        const start = bytes.readUInt32LE(eocd + 16);
        assert(start + centralSize === eocd, "source central directory bounds do not match EOCD");
        const names = new Map();
        let offset = start;
        for (let index = 0; index < entries; index++) {
            assert(bytes.readUInt32LE(offset) === 0x02014b50, "source central directory is malformed");
            const nameLength = bytes.readUInt16LE(offset + 28);
            const extraLength = bytes.readUInt16LE(offset + 30);
            const commentLength = bytes.readUInt16LE(offset + 32);
            const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
            const key = name.toLowerCase();
            assert(!names.has(key), `source ZIP has duplicate/case-ambiguous entries: ${name}`);
            names.set(key, name);
            offset += 46 + nameLength + extraLength + commentLength;
    }
    assert(offset === start + centralSize, "source central directory count/size mismatch");
}

(async () => {
    assert(fs.existsSync(packageDirectory), "dist directory is missing");
    const packages = fs.readdirSync(packageDirectory).filter((entry) => entry.endsWith(".pbiviz"));
    assert(packages.length === 1, "dist must contain exactly one PBIVIZ");
    assert(packages[0] === packageName, `package filename must be ${packageName}`);
    assert(fs.statSync(packagePath).size > 0, "PBIVIZ is empty");

    const sourceBytes = fs.readFileSync(packagePath);
    assertRawUniqueNames(sourceBytes);
    const source = await JSZip.loadAsync(sourceBytes);
    const normalized = new JSZip();
    for (const name of Object.keys(source.files).sort()) {
        const entry = source.files[name];
        const data = entry.dir ? null : await entry.async("nodebuffer");
        normalized.file(name, data, {
            compression: "DEFLATE",
            compressionOptions: { level: 9 },
            createFolders: false,
            date: fixedDate,
            dir: entry.dir,
            dosPermissions: entry.dir ? 0x10 : 0x20,
            unixPermissions: entry.dir ? 0o40755 : 0o100644
        });
    }
    const bytes = await normalized.generateAsync({
        comment: "",
        compression: "DEFLATE",
        compressionOptions: { level: 9 },
        platform: "DOS",
        type: "nodebuffer"
    });
    writeFileAtomic.sync(packagePath, bytes, { mode: 0o644 });
    console.log(`Normalized ${packageName} (${bytes.length} bytes)`);
})().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
});
