const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const JSZip = require("jszip");
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ENTRY_UNCOMPRESSED = 64 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED = 512 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 500;
const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    crcTable[index] = value >>> 0;
}

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseExtraFields(extra) {
    for (let offset = 0; offset < extra.length;) {
        if (offset + 4 > extra.length) throw new Error("ZIP extra field is truncated.");
        const id = extra.readUInt16LE(offset);
        const length = extra.readUInt16LE(offset + 2);
        if (offset + 4 + length > extra.length) throw new Error("ZIP extra field exceeds bounds.");
        if (id === 0x0001) throw new Error("ZIP64 entries are not supported.");
        if (id === 0x7075) throw new Error("ZIP Unicode path overrides are not supported.");
        offset += 4 + length;
    }

}

function decodeZipName(bytes, flags) {
    if ([...bytes].some((value) => value > 0x7f) && (flags & 0x0800) === 0) {
        throw new Error("Non-ASCII ZIP names must declare UTF-8.");
    }

    try {
        return strictUtf8.decode(bytes);
    } catch {
        throw new Error("ZIP filename is not valid UTF-8.");
    }
}

function crc32(bytes) {
        let crc = 0xffffffff;
        for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

function validateZipPayloads(bytes, records) {
        if (records.length > MAX_ZIP_ENTRIES) throw new Error("ZIP entry count exceeds budget.");
        let total = 0;
        for (const record of records) {
            if (record.uncompressedSize > MAX_ENTRY_UNCOMPRESSED) {
                throw new Error(`ZIP entry exceeds uncompressed budget: ${record.name}`);
            }

            total += record.uncompressedSize;
            if (total > MAX_TOTAL_UNCOMPRESSED) throw new Error("ZIP total uncompressed budget exceeded.");
            if (record.compressedSize === 0 && record.uncompressedSize > 0) {
                throw new Error(`ZIP entry has an invalid compression ratio: ${record.name}`);
            }
            if (record.compressedSize > 0 &&
                record.uncompressedSize / record.compressedSize > MAX_COMPRESSION_RATIO) {
                throw new Error(`ZIP entry compression ratio exceeds budget: ${record.name}`);
            }
            const compressed = bytes.subarray(record.dataStart, record.dataEnd);
            let actual;
            if (record.method === 0) {
                actual = compressed;
            } else {
                let inflated;
                try {
                    inflated = zlib.inflateRawSync(compressed, {
                        maxOutputLength: MAX_ENTRY_UNCOMPRESSED + 1,
                        info: true
                    });
                } catch {
                    throw new Error(`ZIP entry decompression failed: ${record.name}`);
                }
                actual = inflated.buffer;
                if (inflated.engine.bytesWritten !== compressed.length) {
                    throw new Error(`ZIP entry has trailing compressed bytes: ${record.name}`);
                }
            }
            if (actual.length !== record.uncompressedSize ||
                compressed.length !== record.compressedSize) {
                throw new Error(`ZIP entry size metadata differs from payload: ${record.name}`);
            }
            if (crc32(actual) !== record.crc32) {
                throw new Error(`ZIP entry CRC32 differs from payload: ${record.name}`);
        }
    }
}

function assertUniqueArchiveNames(records) {
    const names = new Map();
    for (const record of records) {
        const key = record.name.toLowerCase();
        if (names.has(key)) {
            throw new Error(
                `ZIP contains duplicate or case-ambiguous entries: ${names.get(key)}, ${record.name}`
            );
        }
        names.set(key, record.name);
    }
}

function parseCanonicalZipRecords(bytes) {
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
    const records = [];
    const localOffsets = new Set();
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
        const flags = bytes.readUInt16LE(offset + 8);
        const method = bytes.readUInt16LE(offset + 10);
        const crc32 = bytes.readUInt32LE(offset + 16);
        const compressedSize = bytes.readUInt32LE(offset + 20);
        const uncompressedSize = bytes.readUInt32LE(offset + 24);
        const localOffset = bytes.readUInt32LE(offset + 42);
        const diskNumberStart = bytes.readUInt16LE(offset + 34);
        const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
        const name = decodeZipName(nameBytes, flags);
        const extra = bytes.subarray(
            offset + 46 + nameLength,
            offset + 46 + nameLength + extraLength
        );
        assertCanonicalArchiveName(name);
        parseExtraFields(extra);
        if ((flags & 0x0001) !== 0) throw new Error("Encrypted ZIP entries are not supported.");
        if (diskNumberStart !== 0) throw new Error("Split-disk ZIP entries are not supported.");
        if ((flags & 0x0008) !== 0) throw new Error("ZIP data descriptors are not supported.");
        if (![0, 8].includes(method)) throw new Error(`Unsupported ZIP compression method: ${method}`);
        if (localOffsets.has(localOffset)) throw new Error("ZIP entries share a local-header offset.");
        localOffsets.add(localOffset);
        if (localOffset + 30 > start || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
            throw new Error("ZIP local header is missing or outside the data region.");
        }
        const localFlags = bytes.readUInt16LE(localOffset + 6);
        const localMethod = bytes.readUInt16LE(localOffset + 8);
        const localCrc32 = bytes.readUInt32LE(localOffset + 14);
        const localCompressedSize = bytes.readUInt32LE(localOffset + 18);
        const localUncompressedSize = bytes.readUInt32LE(localOffset + 22);
        const localNameLength = bytes.readUInt16LE(localOffset + 26);
        const localExtraLength = bytes.readUInt16LE(localOffset + 28);
        const localNameStart = localOffset + 30;
        const localNameEnd = localNameStart + localNameLength;
        const localExtraEnd = localNameEnd + localExtraLength;
        if (localExtraEnd > start) throw new Error("ZIP local header exceeds the data region.");
        const localNameBytes = bytes.subarray(localNameStart, localNameEnd);
        const localName = decodeZipName(localNameBytes, localFlags);
        const localExtra = bytes.subarray(localNameEnd, localExtraEnd);
        assertCanonicalArchiveName(localName);
        parseExtraFields(localExtra);
        if (!localNameBytes.equals(nameBytes) || localName !== name ||
            localFlags !== flags || localMethod !== method ||
            localCrc32 !== crc32 || localCompressedSize !== compressedSize ||
            localUncompressedSize !== uncompressedSize) {
            throw new Error("ZIP local and central records disagree.");
        }
        const dataEnd = localExtraEnd + compressedSize;
        if (dataEnd > start) throw new Error("ZIP entry data overlaps the central directory.");
        records.push({
            name,
            localOffset,
            dataStart: localExtraEnd,
            dataEnd,
            flags,
            method,
            crc32,
            compressedSize,
            uncompressedSize
        });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    if (offset !== start + size) throw new Error("ZIP central-directory size does not match entries.");
    const ranges = records
        .map((record) => [record.localOffset, record.dataEnd, record.name])
        .sort((left, right) => left[0] - right[0]);
    for (let index = 1; index < ranges.length; index++) {
        if (ranges[index][0] < ranges[index - 1][1]) {
            throw new Error(`ZIP local entry ranges overlap: ${ranges[index - 1][2]} and ${ranges[index][2]}`);
        }
    }
    let localCursor = 0;
    for (const record of [...records].sort((left, right) => left.localOffset - right.localOffset)) {
        if (record.localOffset !== localCursor) {
            throw new Error("ZIP contains an unmatched local record or data gap.");
        }
        localCursor = record.dataEnd;
    }
    if (localCursor !== start) {
        throw new Error("ZIP local records do not exactly cover the data region.");
    }
    return records;
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
    const { packageBytes, archivePath: resourcePath, payload } =
        await packagePayload(packagePath, guid);
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
    const packageRecords = parseCanonicalZipRecords(packageBytes);
    assertUniqueArchiveNames(packageRecords);
    validateZipPayloads(packageBytes, packageRecords);
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
    const records = parseCanonicalZipRecords(pbixBytes);
    assertUniqueArchiveNames(records);
    validateZipPayloads(pbixBytes, records);
    const rawNames = records.map((record) => record.name);
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
    assertUniqueArchiveNames,
    crc32,
    parseExtraFields,
    validateZipPayloads,
    requireCanonicalPbixResource,
    parseCanonicalZipRecords,
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
