const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function centralDirectoryNames(bytes) {
    let eocd = -1;
    const minimum = Math.max(0, bytes.length - 65_557);
    for (let offset = bytes.length - 22; offset >= minimum; offset--) {
        if (bytes.readUInt32LE(offset) === 0x06054b50) {
            eocd = offset;
            break;
        }
    }
    if (eocd < 0) throw new Error("ZIP end-of-central-directory record is missing.");
    const disk = bytes.readUInt16LE(eocd + 4);
    const centralDisk = bytes.readUInt16LE(eocd + 6);
    const diskEntries = bytes.readUInt16LE(eocd + 8);
    const entries = bytes.readUInt16LE(eocd + 10);
    const size = bytes.readUInt32LE(eocd + 12);
    const start = bytes.readUInt32LE(eocd + 16);
    const commentLength = bytes.readUInt16LE(eocd + 20);
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entries) {
        throw new Error("Multi-disk ZIP archives are not supported.");
    }
    if (eocd + 22 + commentLength !== bytes.length) {
        throw new Error("ZIP end-of-central-directory is not anchored to EOF.");
    }
    if (entries === 0xffff || size === 0xffffffff || start === 0xffffffff) {
        throw new Error("ZIP64 PBIX archives are not supported for canonical resource proof.");
    }
    if (start + size !== eocd || start > bytes.length) {
        throw new Error("ZIP central-directory bounds are invalid.");
    }
    const names = [];
    let offset = start;
    for (let index = 0; index < entries; index++) {
        if (offset + 46 > start + size || bytes.readUInt32LE(offset) !== 0x02014b50) {
            throw new Error("ZIP central-directory entry is invalid.");
        }
        const nameLength = bytes.readUInt16LE(offset + 28);
        const extraLength = bytes.readUInt16LE(offset + 30);
        const commentLength = bytes.readUInt16LE(offset + 32);
        if (offset + 46 + nameLength + extraLength + commentLength > start + size) {
            throw new Error("ZIP central-directory entry exceeds its declared bounds.");
        }
        names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
        offset += 46 + nameLength + extraLength + commentLength;
    }
    if (offset !== start + size) throw new Error("ZIP central-directory size does not match entries.");
    return names;
}

function assertCanonicalArchiveName(name) {
    if (name.includes("\\") || name.startsWith("/") || name.includes("//") ||
        name.split("/").some((segment) => segment === "." || segment === "..")) {
        throw new Error(`Noncanonical archive entry: ${name}`);
    }
}

function decodeMetadata(bytes) {
    const sample = bytes.subarray(0, Math.min(bytes.length, 200));
    const zeros = [...sample].filter((value) => value === 0).length;
    return bytes.toString(zeros > sample.length / 4 ? "utf16le" : "utf8")
        .replace(/^\uFEFF/, "");
}

function resolveActiveResourcePointer(metadataText, guid, canonical) {
    let layout;
    try {
        layout = JSON.parse(metadataText);
    } catch {
        return { status: "unavailable", path: null };
    }
    const resourcePackages = Array.isArray(layout.resourcePackages) ? layout.resourcePackages : null;
    const sections = Array.isArray(layout.sections) ? layout.sections : null;
    if (!resourcePackages || !sections) return { status: "unavailable", path: null };
    const packages = resourcePackages.filter((entry) =>
        entry?.name === guid && entry?.type === "CustomVisual"
    );
    if (packages.length !== 1) return { status: "wrong-or-missing", path: null };
    const expectedItem = `${guid}.pbiviz.json`;
    const items = Array.isArray(packages[0].items) ? packages[0].items : [];
    const matchingItems = items.filter((item) =>
        item?.name === expectedItem &&
        item?.path === expectedItem &&
        item?.type === "CustomVisualMetadata"
    );
    if (matchingItems.length !== 1) return { status: "wrong-or-missing", path: null };
    let activeVisuals = 0;
    for (const section of sections) {
        for (const container of section?.visualContainers ?? []) {
            let config = container?.config;
            if (typeof config === "string") {
                try { config = JSON.parse(config); } catch { continue; }
            }
            if (config?.singleVisual?.visualType === guid) activeVisuals++;
        }
    }
    return activeVisuals > 0
        ? { status: "resolved", path: canonical }
        : { status: "wrong-or-missing", path: null };
}

function requireCanonicalPbixResource(rawNames, guid) {
    for (const name of rawNames) assertCanonicalArchiveName(name);
    const duplicateNames = rawNames.filter((name, index) => rawNames.indexOf(name) !== index);
    if (duplicateNames.length > 0) {
        throw new Error(`PBIX contains duplicate archive entries: ${duplicateNames.join(", ")}`);
    }
    const canonical = `Report/CustomVisuals/${guid}/resources/${guid}.pbiviz.json`;
    const suffix = `CustomVisuals/${guid}/resources/${guid}.pbiviz.json`;
    const resourceLike = rawNames.filter((entry) =>
        entry.toLowerCase().endsWith(suffix.toLowerCase())
    );
    if (resourceLike.some((entry) => entry !== canonical)) {
        throw new Error("PBIX contains a noncanonical or decoy custom visual resource path.");
    }
    const exact = resourceLike.filter((entry) => entry === canonical);
    if (exact.length !== 1) throw new Error("PBIX must contain exactly one canonical custom visual resource.");
    return canonical;
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
    const rawNames = centralDirectoryNames(pbixBytes);
    const pbix = await JSZip.loadAsync(pbixBytes);
    const canonical = requireCanonicalPbixResource(rawNames, guid);
    const resource = pbix.files[canonical];
    if (!resource || resource.dir) throw new Error("Canonical PBIX custom visual resource is missing.");
    const bytes = await resource.async("nodebuffer");
    if (!bytes.equals(payload)) {
        throw new Error("PBIX embedded custom visual differs from the final PBIVIZ payload.");
    }
    const metadataEntry = pbix.files["Report/Layout"];
    let activePointer = { status: "unavailable", path: null };
    if (metadataEntry && !metadataEntry.dir) {
        const metadata = decodeMetadata(await metadataEntry.async("nodebuffer"));
        activePointer = resolveActiveResourcePointer(metadata, guid, canonical);
    }
    const embedded = [];
    embedded.push({ path: canonical, bytes: bytes.length, sha256: sha256(bytes) });
    return {
        package: { bytes: packageBytes.length, sha256: sha256(packageBytes) },
        payload: { archivePath, bytes: payload.length, sha256: sha256(payload) },
        pbix: { bytes: pbixBytes.length, sha256: sha256(pbixBytes) },
        embedded,
        presenceParity: true,
        activePointer,
        activeParity: activePointer.status === "resolved"
    };
}

module.exports = {
    requireCanonicalPbixResource,
    resolveActiveResourcePointer,
    verifyPbixVisualParity,
    verifySampleResourceParity
};

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
