const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function verifySampleResourceParity({ packagePath, sampleRoot, guid }) {
    const packageBytes = fs.readFileSync(packagePath);
    const zip = await JSZip.loadAsync(packageBytes);
    const resourcePath = `resources/${guid}.pbiviz.json`;
    const resource = zip.files[resourcePath];
    if (!resource || resource.dir) {
        throw new Error(`PBIVIZ resource is missing: ${resourcePath}`);
    }
    const payload = await resource.async("nodebuffer");
    const embedded = [];
    function walk(directory) {
        for (const entry of fs.readdirSync(directory).sort()) {
            const absolute = path.join(directory, entry);
            if (fs.statSync(absolute).isDirectory()) {
                walk(absolute);
            } else if (
                absolute.endsWith(path.join(
                    "CustomVisuals",
                    guid,
                    "resources",
                    `${guid}.pbiviz.json`
                ))
            ) {
                const bytes = fs.readFileSync(absolute);
                if (!bytes.equals(payload)) {
                    throw new Error("Sample embedded custom visual differs from the final PBIVIZ payload.");
                }
                embedded.push({
                    path: path.relative(sampleRoot, absolute).split(path.sep).join("/"),
                    bytes: bytes.length,
                    sha256: sha256(bytes)
                });
            }
        }
    }
    walk(sampleRoot);
    if (embedded.length === 0) {
        throw new Error("No sample embedded custom visual resource was found.");
    }
    return {
        package: {
            bytes: packageBytes.length,
            sha256: sha256(packageBytes)
        },
        payload: {
            archivePath: resourcePath,
            bytes: payload.length,
            sha256: sha256(payload)
        },
        embedded,
        parity: true
    };
}

async function packagePayload(packagePath, guid) {
    const packageBytes = fs.readFileSync(packagePath);
    const zip = await JSZip.loadAsync(packageBytes);
    const archivePath = `resources/${guid}.pbiviz.json`;
    const resource = zip.files[archivePath];
    if (!resource || resource.dir) throw new Error(`PBIVIZ resource is missing: ${archivePath}`);
    return {
        packageBytes,
        archivePath,
        payload: await resource.async("nodebuffer")
    };
}

async function verifyPbixVisualParity({ packagePath, pbixPath, guid }) {
    const { packageBytes, archivePath, payload } = await packagePayload(packagePath, guid);
    const pbixBytes = fs.readFileSync(pbixPath);
    const pbix = await JSZip.loadAsync(pbixBytes);
    const suffix = `CustomVisuals/${guid}/resources/${guid}.pbiviz.json`;
    const matches = Object.entries(pbix.files)
        .filter(([entry, value]) => !value.dir && entry.replaceAll("\\", "/").endsWith(suffix));
    if (matches.length === 0) {
        throw new Error("PBIX contains no matching embedded custom visual resource.");
    }
    const embedded = [];
    for (const [entry, value] of matches) {
        const bytes = await value.async("nodebuffer");
        if (!bytes.equals(payload)) {
            throw new Error("PBIX embedded custom visual differs from the final PBIVIZ payload.");
        }
        embedded.push({ path: entry, bytes: bytes.length, sha256: sha256(bytes) });
    }
    return {
        package: { bytes: packageBytes.length, sha256: sha256(packageBytes) },
        payload: { archivePath, bytes: payload.length, sha256: sha256(payload) },
        pbix: { bytes: pbixBytes.length, sha256: sha256(pbixBytes) },
        embedded,
        parity: true
    };
}

module.exports = { verifyPbixVisualParity, verifySampleResourceParity };

if (require.main === module) {
    const root = path.resolve(__dirname, "..");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    const packagePath = path.join(
        root,
        "dist",
        `${manifest.visual.name}.${manifest.visual.version}.pbiviz`
    );
    const operation = process.argv[2] === "--pbix"
        ? verifyPbixVisualParity({
            packagePath,
            pbixPath: path.resolve(process.argv[3]),
            guid: manifest.visual.guid
        })
        : verifySampleResourceParity({
            packagePath,
            sampleRoot: path.join(root, "samples", "AtlynProfileLensSample"),
            guid: manifest.visual.guid
        });
    operation.then((result) => {
        process.stdout.write(JSON.stringify(result));
    }).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
