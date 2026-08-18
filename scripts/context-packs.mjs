import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
    mkdir,
    readFile,
    readdir,
    rm,
    writeFile
} from "node:fs/promises";
import { request } from "node:https";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import JSZip from "jszip";
import * as shapefile from "shapefile";
import { geoBounds, geoCentroid } from "d3-geo";
import { feature, neighbors, quantize } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, quantile, simplify } from "topojson-simplify";

const root = resolve(import.meta.dirname, "..");
const catalogPath = join(root, "context-packs", "sources.json");
const cacheDirectory = join(root, "context-packs", "cache");
const generatedDirectory = join(root, "src", "context", "packs", "generated");
const expectedStateCodes = [
    "01", "02", "04", "05", "06", "08", "09", "10", "11", "12", "13", "15",
    "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27",
    "28", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "39",
    "40", "41", "42", "44", "45", "46", "47", "48", "49", "50", "51", "53",
    "54", "55", "56", "60", "66", "69", "72", "78"
];
const sizeBudgets = {
    "world-countries-110m": { raw: 150 * 1024, gzip: 60 * 1024 },
    "world-countries-50m": { raw: 850 * 1024, gzip: 300 * 1024 },
    "us-states-2025-5m": { raw: 550 * 1024, gzip: 150 * 1024 },
    "us-counties-2025-5m": { raw: 1800 * 1024, gzip: 500 * 1024 }
};

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function compareKeys(left, right) {
    return left === right ? 0 : left < right ? -1 : 1;
}

async function catalog() {
    return JSON.parse(await readFile(catalogPath, "utf8"));
}

function download(url, redirects = 0) {
    if (redirects > 5) {
        throw new Error(`Too many redirects while downloading ${url}`);
    }
    return new Promise((resolveDownload, reject) => {
        const operation = request(url, { method: "GET" }, (response) => {
            if (
                response.statusCode >= 300
                && response.statusCode < 400
                && response.headers.location
            ) {
                response.resume();
                resolveDownload(download(new URL(response.headers.location, url).href, redirects + 1));
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
                return;
            }
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolveDownload(Buffer.concat(chunks)));
            response.on("error", reject);
        });
        operation.on("error", reject);
        operation.end();
    });
}

function verifySource(source, bytes) {
    if (bytes.length !== source.bytes) {
        throw new Error(`${source.id} byte length changed: ${bytes.length} != ${source.bytes}`);
    }
    const actual = sha256(bytes);
    if (actual !== source.sha256) {
        throw new Error(`${source.id} SHA-256 changed: ${actual} != ${source.sha256}`);
    }
}

async function fetchSources() {
    const value = await catalog();
    await mkdir(cacheDirectory, { recursive: true });
    for (const source of value.sources) {
        const destination = join(cacheDirectory, source.filename);
        if (existsSync(destination)) {
            const cached = await readFile(destination);
            verifySource(source, cached);
            console.log(`Verified cached ${source.filename}`);
            continue;
        }
        const bytes = await download(source.url);
        verifySource(source, bytes);
        await writeFile(destination, bytes);
        console.log(`Fetched ${source.filename} (${bytes.length} bytes)`);
    }
}

async function readShapefile(source) {
    const archivePath = join(cacheDirectory, source.filename);
    if (!existsSync(archivePath)) {
        throw new Error(`Missing ${source.filename}; run npm run packs:fetch first.`);
    }
    const archiveBytes = await readFile(archivePath);
    verifySource(source, archiveBytes);
    const archive = await JSZip.loadAsync(archiveBytes);
    const names = Object.keys(archive.files);
    const shpName = names.find((name) => name.toLowerCase().endsWith(".shp"));
    const dbfName = names.find((name) => name.toLowerCase().endsWith(".dbf"));
    if (!shpName || !dbfName) {
        throw new Error(`${source.filename} does not contain one SHP/DBF pair.`);
    }
    const shp = await archive.file(shpName).async("nodebuffer");
    const dbf = await archive.file(dbfName).async("nodebuffer");
    return shapefile.read(shp, dbf);
}

function regionForState(stateCode) {
    if (stateCode === "02") return "alaska";
    if (stateCode === "15") return "hawaii";
    if (stateCode === "60") return "americanSamoa";
    if (stateCode === "66") return "guam";
    if (stateCode === "69") return "northernMarianaIslands";
    if (stateCode === "72") return "puertoRico";
    if (stateCode === "78") return "usVirginIslands";
    return "conus";
}

function sourceText(value) {
    return String(value).replace(/\0/g, "").trim();
}

function retainedProperties(source, properties) {
    if (source.kind === "world") {
        const iso = sourceText(properties.ISO_A3);
        const adm0 = sourceText(properties.ADM0_A3);
        return {
            canonicalKey: iso === "-99" ? `NE:${adm0}` : iso,
            sourceId: `NE:${sourceText(properties.NE_ID)}`,
            name: sourceText(properties.NAME),
            status: sourceText(properties.TYPE),
            region: "world",
            fallback: iso === "-99"
        };
    }
    const key = sourceText(properties.GEOID);
    const stateCode = source.kind === "county" ? sourceText(properties.STATEFP) : key;
    return {
        canonicalKey: key,
        sourceId: source.kind === "county" ? `CENSUS:COUNTY:${key}` : `CENSUS:STATE:${key}`,
        name: sourceText(properties.NAME),
        status: sourceText(properties.STUSPS),
        stateCode,
        region: regionForState(stateCode),
        fallback: false
    };
}

function finitePoint(point, label) {
    if (
        !Array.isArray(point)
        || point.length !== 2
        || !Number.isFinite(point[0])
        || !Number.isFinite(point[1])
    ) {
        throw new Error(`${label} is not a finite two-dimensional point.`);
    }
    return point.map((value) => Object.is(value, -0) ? 0 : Number(value.toFixed(8)));
}

function keyModesFor(source) {
    if (source.kind === "world") {
        return [
            {
                id: "canonical",
                displayName: "ISO alpha-3 or prefixed Natural Earth fallback",
                example: "USA or NE:KOS"
            },
            {
                id: "isoAlpha3CaseFold",
                displayName: "ISO alpha-3, ASCII case-insensitive",
                example: "usa"
            }
        ];
    }
    return [{
        id: source.kind === "state" ? "geoid2" : "geoid5",
        displayName: source.kind === "state"
            ? "Two-digit state/equivalent GEOID text"
            : "Five-digit county/equivalent GEOID text",
        example: source.kind === "state" ? "06" : "06037"
    }];
}

function manifestFor(source, features, payloadHash) {
    const fallbackKeys = features
        .filter((entry) => entry.properties.fallback)
        .map((entry) => entry.properties.canonicalKey)
        .sort(compareKeys);
    return {
        schemaVersion: 1,
        id: source.id,
        displayName: source.kind === "world"
            ? `World countries (${source.detail})`
            : source.kind === "state"
                ? "US states and equivalents (2025, 5m)"
                : "US counties and equivalents (2025, 5m)",
        level: source.kind === "world" ? "country" : source.kind,
        vintage: source.vintage,
        detail: source.detail,
        projectionId: source.kind === "world" ? "naturalEarth1-v1" : "us-composite-v1",
        keyModes: keyModesFor(source),
        featureCount: features.length,
        sourceName: source.kind === "world"
            ? "Natural Earth Admin-0 countries"
            : "U.S. Census Bureau Cartographic Boundary Files",
        sourceLicense: "Public domain",
        attribution: source.kind === "world"
            ? "Made with Natural Earth."
            : "U.S. Census Bureau, 2025 Cartographic Boundary Files.",
        policyId: source.kind === "world" ? "natural-earth-de-facto-v1" : "us-territory-insets-v1",
        sourceArchiveSha256: source.sha256,
        artifactSha256: payloadHash,
        fallbackKeys
    };
}

async function buildSource(source) {
    const collection = await readShapefile(source);
    if (collection.type !== "FeatureCollection") {
        throw new Error(`${source.id} did not parse as a FeatureCollection.`);
    }
    if (collection.features.length !== source.expectedFeatures) {
        throw new Error(
            `${source.id} feature count changed: ${collection.features.length} != ${source.expectedFeatures}`
        );
    }
    const sourceFeatures = collection.features.map((entry) => {
        if (!entry.geometry) {
            throw new Error(`${source.id} contains null geometry.`);
        }
        const properties = retainedProperties(source, entry.properties ?? {});
        return {
            type: "Feature",
            properties,
            geometry: entry.geometry
        };
    }).sort((left, right) =>
        compareKeys(left.properties.canonicalKey, right.properties.canonicalKey));

    const keys = new Set();
    for (const entry of sourceFeatures) {
        if (keys.has(entry.properties.canonicalKey)) {
            throw new Error(`${source.id} duplicate canonical key ${entry.properties.canonicalKey}`);
        }
        keys.add(entry.properties.canonicalKey);
        entry.properties.centroid = finitePoint(
            geoCentroid(entry),
            `${source.id}:${entry.properties.canonicalKey} centroid`
        );
        const bounds = geoBounds(entry);
        entry.properties.bounds = [
            ...finitePoint(bounds[0], `${source.id}:${entry.properties.canonicalKey} minimum bounds`),
            ...finitePoint(bounds[1], `${source.id}:${entry.properties.canonicalKey} maximum bounds`)
        ];
    }

    let packedTopology = topology({
        features: { type: "FeatureCollection", features: sourceFeatures }
    }, 100000);
    packedTopology = presimplify(packedTopology);
    const threshold = quantile(packedTopology, 0.001);
    packedTopology = simplify(packedTopology, threshold);
    if (!packedTopology.transform) {
        packedTopology = quantize(packedTopology, 100000);
    }
    const geometries = packedTopology.objects.features.geometries;
    const adjacency = neighbors(geometries);
    geometries.forEach((geometry, index) => {
        geometry.properties.neighbors = adjacency[index]
            .map((neighborIndex) => geometries[neighborIndex].properties.canonicalKey)
            .sort(compareKeys);
    });

    const payload = { topology: packedTopology };
    const payloadHash = sha256(Buffer.from(JSON.stringify(payload)));
    const output = {
        manifest: manifestFor(source, sourceFeatures, payloadHash),
        ...payload
    };
    return `${JSON.stringify(output)}\n`;
}

async function buildPacks(outputDirectory = generatedDirectory) {
    const value = await catalog();
    await mkdir(outputDirectory, { recursive: true });
    const expectedFiles = new Set();
    for (const source of value.sources) {
        const filename = `${source.id}.pack.json`;
        expectedFiles.add(filename);
        const contents = await buildSource(source);
        await writeFile(join(outputDirectory, filename), contents);
        console.log(`Built ${filename} (${Buffer.byteLength(contents)} bytes)`);
    }
    for (const name of await readdir(outputDirectory)) {
        if (name.endsWith(".pack.json") && !expectedFiles.has(name)) {
            await rm(join(outputDirectory, name));
        }
    }
}

function visitCoordinates(value, label) {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error(`${label} contains a non-finite coordinate.`);
        }
        return;
    }
    if (!Array.isArray(value)) {
        throw new Error(`${label} contains malformed coordinates.`);
    }
    for (const item of value) {
        visitCoordinates(item, label);
    }
}

async function validatePack(source, filePath) {
    const bytes = await readFile(filePath);
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (parsed.manifest.schemaVersion !== 1 || parsed.manifest.id !== source.id) {
        throw new Error(`${source.id} manifest identity is invalid.`);
    }
    if (parsed.manifest.featureCount !== source.expectedFeatures) {
        throw new Error(`${source.id} manifest feature count is invalid.`);
    }
    if (parsed.manifest.sourceArchiveSha256 !== source.sha256) {
        throw new Error(`${source.id} source hash is stale.`);
    }
    if (/https?:\/\//.test(bytes.toString("utf8"))) {
        throw new Error(`${source.id} runtime asset contains a remote URL.`);
    }
    const payloadHash = sha256(Buffer.from(JSON.stringify({ topology: parsed.topology })));
    if (payloadHash !== parsed.manifest.artifactSha256) {
        throw new Error(`${source.id} payload hash is invalid.`);
    }
    const collection = feature(parsed.topology, parsed.topology.objects.features);
    if (collection.features.length !== source.expectedFeatures) {
        throw new Error(`${source.id} decoded feature count is invalid.`);
    }
    const keys = new Set();
    const fallbackKeys = [];
    for (const entry of collection.features) {
        const properties = entry.properties;
        const key = properties.canonicalKey;
        if (keys.has(key)) {
            throw new Error(`${source.id} decoded duplicate key ${key}.`);
        }
        keys.add(key);
        if (properties.fallback) fallbackKeys.push(key);
        if (!entry.geometry) {
            throw new Error(`${source.id}:${key} has null geometry.`);
        }
        visitCoordinates(entry.geometry.coordinates, `${source.id}:${key}`);
        finitePoint(properties.centroid, `${source.id}:${key} centroid`);
        if (
            !Array.isArray(properties.bounds)
            || properties.bounds.length !== 4
            || properties.bounds.some((value) => !Number.isFinite(value))
        ) {
            throw new Error(`${source.id}:${key} has invalid bounds.`);
        }
        if (!Array.isArray(properties.neighbors)) {
            throw new Error(`${source.id}:${key} has invalid adjacency.`);
        }
        if (source.kind === "state" && !/^\d{2}$/.test(key)) {
            throw new Error(`${source.id}:${key} is not a two-digit text GEOID.`);
        }
        if (source.kind === "county") {
            if (!/^\d{5}$/.test(key) || key.slice(0, 2) !== properties.stateCode) {
                throw new Error(`${source.id}:${key} has an invalid county/state relationship.`);
            }
        }
    }
    fallbackKeys.sort(compareKeys);
    if (JSON.stringify(fallbackKeys) !== JSON.stringify(parsed.manifest.fallbackKeys)) {
        throw new Error(`${source.id} fallback-key manifest does not match generated source policy.`);
    }
    if (source.kind === "state") {
        const actual = [...keys].sort(compareKeys);
        if (JSON.stringify(actual) !== JSON.stringify(expectedStateCodes)) {
            throw new Error(`${source.id} state/equivalent coverage changed.`);
        }
    }
    for (const entry of collection.features) {
        for (const neighbor of entry.properties.neighbors) {
            const other = collection.features.find(
                (candidate) => candidate.properties.canonicalKey === neighbor
            );
            if (!other?.properties.neighbors.includes(entry.properties.canonicalKey)) {
                throw new Error(`${source.id} adjacency is not symmetric.`);
            }
        }
    }
    const budget = sizeBudgets[source.id];
    const gzipBytes = gzipSync(bytes, { level: 9 }).length;
    if (bytes.length > budget.raw || gzipBytes > budget.gzip) {
        throw new Error(
            `${source.id} exceeds size budget: ${bytes.length}/${gzipBytes} > `
            + `${budget.raw}/${budget.gzip}`
        );
    }
    return { id: source.id, rawBytes: bytes.length, gzipBytes, sha256: sha256(bytes) };
}

async function validatePacks(directory = generatedDirectory) {
    const value = await catalog();
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    for (const [name, version] of Object.entries(value.toolchain)) {
        const actual = packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name];
        if (actual !== version) {
            throw new Error(`Context pack tool ${name} must be pinned to ${version}; received ${actual}.`);
        }
    }
    const results = [];
    for (const source of value.sources) {
        results.push(await validatePack(
            source,
            join(directory, `${source.id}.pack.json`)
        ));
    }
    const defaultResults = results.filter((entry) => entry.id !== "world-countries-50m");
    const defaultRaw = defaultResults.reduce((sum, entry) => sum + entry.rawBytes, 0);
    const defaultGzip = defaultResults.reduce((sum, entry) => sum + entry.gzipBytes, 0);
    if (defaultRaw > 2.5 * 1024 * 1024 || defaultGzip > 750 * 1024) {
        throw new Error(`Default pack set exceeds combined budget: ${defaultRaw}/${defaultGzip}`);
    }
    console.table(results);
    return results;
}

async function verifyPacks() {
    const temporary = join(root, ".tmp", "context-pack-verify");
    await rm(temporary, { recursive: true, force: true });
    await buildPacks(temporary);
    const value = await catalog();
    for (const source of value.sources) {
        const filename = `${source.id}.pack.json`;
        const committed = await readFile(join(generatedDirectory, filename));
        const rebuilt = await readFile(join(temporary, filename));
        if (!committed.equals(rebuilt)) {
            throw new Error(`${filename} differs from a deterministic rebuild.`);
        }
    }
    await rm(temporary, { recursive: true, force: true });
    console.log("Committed context packs match a clean deterministic rebuild.");
}

async function reproducePacks() {
    const parent = join(root, ".tmp", "context-pack-repro");
    await rm(parent, { recursive: true, force: true });
    const timezones = ["Etc/GMT+12", "Etc/GMT-14"];
    const directories = timezones.map((unused, index) => join(parent, `run-${index + 1}`));
    for (let index = 0; index < timezones.length; index += 1) {
        const result = spawnSync(
            process.execPath,
            [import.meta.filename, "build-to", directories[index]],
            {
                cwd: root,
                env: { ...process.env, TZ: timezones[index] },
                stdio: "inherit"
            }
        );
        if (result.status !== 0) {
            throw new Error(`Context pack reproducibility run failed for ${timezones[index]}.`);
        }
    }
    const value = await catalog();
    for (const source of value.sources) {
        const filename = `${source.id}.pack.json`;
        const first = await readFile(join(directories[0], filename));
        const second = await readFile(join(directories[1], filename));
        if (!first.equals(second)) {
            throw new Error(`${filename} differs across timezones.`);
        }
    }
    await rm(parent, { recursive: true, force: true });
    console.log(`Context packs are byte-identical across ${timezones.join(" and ")}.`);
}

const command = process.argv[2];
try {
    if (command === "fetch") {
        await fetchSources();
    } else if (command === "build") {
        await buildPacks();
    } else if (command === "build-to") {
        await buildPacks(resolve(process.argv[3]));
    } else if (command === "validate") {
        await validatePacks();
    } else if (command === "verify") {
        await verifyPacks();
    } else if (command === "repro") {
        await reproducePacks();
    } else {
        throw new Error("Usage: context-packs.mjs fetch|build|validate|verify|repro");
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
