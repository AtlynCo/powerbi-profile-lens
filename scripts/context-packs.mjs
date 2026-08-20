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
import { geoArea, geoBounds, geoCentroid, geoGraticule10 } from "d3-geo";
import { feature, merge, mesh, neighbors, quantize } from "topojson-client";
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
const usInsets = [
    { id: "alaska", text: "Alaska", bounds: [0, 480, 220, 160] },
    { id: "hawaii", text: "Hawaii", bounds: [230, 480, 110, 75] },
    { id: "puertoRico", text: "Puerto Rico", bounds: [350, 480, 180, 75] },
    { id: "usVirginIslands", text: "USVI", bounds: [540, 480, 80, 75] },
    { id: "americanSamoa", text: "American Samoa", bounds: [630, 480, 100, 75] },
    { id: "guam", text: "Guam", bounds: [740, 480, 90, 75] },
    { id: "northernMarianaIslands", text: "Northern Mariana Islands", bounds: [840, 480, 120, 75] }
];
function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function geometryCollection(geometries) {
    return { type: "GeometryCollection", geometries };
}

function referenceFeature(id, region, geometry, extra = {}) {
    return {
        type: "Feature",
        properties: { id, region, ...extra },
        geometry
    };
}

function usReferenceInputs(source, sourceFeatures) {
    let sourceTopology = topology({
        features: { type: "FeatureCollection", features: sourceFeatures }
    }, 100000);
    sourceTopology = presimplify(sourceTopology);
    sourceTopology = simplify(sourceTopology, quantile(sourceTopology, 0.001));
    if (!sourceTopology.transform) sourceTopology = quantize(sourceTopology, 100000);
    const decoded = feature(sourceTopology, sourceTopology.objects.features);
    const geometries = sourceTopology.objects.features.geometries;
    const land = [];
    const coastline = [];
    const admin1 = [];
    const admin2 = [];
    const stateLabels = [];

    for (const region of [...new Set(sourceFeatures.map((entry) => entry.properties.region))].sort(compareKeys)) {
        const regionGeometries = geometries.filter((entry) => entry.properties.region === region);
        const regionObject = geometryCollection(regionGeometries);
        land.push(referenceFeature(`land:${region}`, region, merge(sourceTopology, regionGeometries)));
        coastline.push(referenceFeature(
            `coastline:${region}`,
            region,
            mesh(sourceTopology, regionObject, (left, right) => left === right)
        ));
        if (source.kind === "state") {
            admin1.push(referenceFeature(
                `admin1:${region}`,
                region,
                mesh(sourceTopology, regionObject, (left, right) => left !== right)
            ));
        } else {
            admin1.push(referenceFeature(
                `admin1:${region}`,
                region,
                mesh(sourceTopology, regionObject, (left, right) =>
                    left !== right && left.properties.stateCode !== right.properties.stateCode)
            ));
            admin2.push(referenceFeature(
                `admin2:${region}`,
                region,
                mesh(sourceTopology, regionObject, (left, right) =>
                    left !== right && left.properties.stateCode === right.properties.stateCode),
                { minZoom: 2.5 }
            ));
        }
    }

    if (source.kind === "county") {
        for (const stateCode of expectedStateCodes) {
            const stateGeometries = geometries.filter(
                (entry) => entry.properties.stateCode === stateCode
            );
            const merged = merge(sourceTopology, stateGeometries);
            const abbreviation = sourceFeatures.find(
                (entry) => entry.properties.stateCode === stateCode
            )?.properties.status;
            stateLabels.push({
                key: `reference:state:${stateCode}`,
                text: abbreviation,
                anchor: finitePoint(
                    geoCentroid({ type: "Feature", properties: {}, geometry: merged }),
                    `${source.id}:${stateCode} state label anchor`
                ),
                rank: Number(stateCode),
                minZoom: 1,
                maxZoom: 3.25,
                region: regionForState(stateCode),
                role: "state"
            });
        }
    }

    const featureLabels = sourceFeatures.map((entry, index) => ({
        key: entry.properties.canonicalKey,
        text: source.kind === "state" ? entry.properties.status : entry.properties.name,
        anchor: entry.properties.centroid,
        rank: index + 1,
        minZoom: source.kind === "state" ? 1 : 3.5,
        region: entry.properties.region,
        role: "feature"
    }));
    return {
        decodedFeatures: decoded.features,
        labels: [...stateLabels, ...featureLabels].sort((left, right) =>
            compareKeys(left.key, right.key)),
        insets: usInsets,
        objects: {
            land: { type: "FeatureCollection", features: land },
            coastline: { type: "FeatureCollection", features: coastline },
            admin1: { type: "FeatureCollection", features: admin1 },
            ...(admin2.length > 0
                ? { admin2: { type: "FeatureCollection", features: admin2 } }
                : {})
        }
    };
}

function compareKeys(left, right) {
    return left === right ? 0 : left < right ? -1 : 1;
}

async function catalog() {
    return JSON.parse(await readFile(catalogPath, "utf8"));
}

function allSources(value) {
    return [...value.sources, ...(value.physicalSources ?? [])];
}

function requiredRetainedFields(source) {
    if (source.kind === "world") {
        return [
            "ADM0_A3", "ISO_A3", "ISO_A3_EH", "LABELRANK", "LABEL_X", "LABEL_Y",
            "NAME", "NE_ID", "TYPE"
        ];
    }
    if (source.kind === "state") return ["GEOID", "NAME", "STUSPS"];
    if (source.kind === "county") return ["GEOID", "NAME", "STATEFP", "STUSPS"];
    return [];
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
    for (const source of allSources(value)) {
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
    const shpEntries = names.filter((name) => name.toLowerCase().endsWith(".shp"));
    const dbfEntries = names.filter((name) => name.toLowerCase().endsWith(".dbf"));
    const shpName = names.find((name) => name === `${source.shapefileBase}.shp`);
    const dbfName = names.find((name) => name === `${source.shapefileBase}.dbf`);
    if (!shpName || !dbfName || shpEntries.length !== 1 || dbfEntries.length !== 1) {
        throw new Error(
            `${source.filename} must contain only the exact `
            + `${source.shapefileBase}.shp/.dbf pair.`
        );
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

function validIsoAlpha3(value) {
    return /^[A-Z]{3}$/.test(value);
}

function worldKeyAssignments(features) {
    const reservedPrimary = new Map();
    for (const entry of features) {
        const properties = entry.properties ?? {};
        const primary = sourceText(properties.ISO_A3);
        if (!validIsoAlpha3(primary)) continue;
        if (reservedPrimary.has(primary)) {
            throw new Error(
                `Natural Earth primary ISO_A3 collision: ${primary} for `
                + `${reservedPrimary.get(primary)} and ${sourceText(properties.NAME)}`
            );
        }
        reservedPrimary.set(primary, sourceText(properties.NAME));
    }
    const alternateCounts = new Map();
    for (const entry of features) {
        const properties = entry.properties ?? {};
        const primary = sourceText(properties.ISO_A3);
        const alternate = sourceText(properties.ISO_A3_EH);
        if (
            !validIsoAlpha3(primary)
            && validIsoAlpha3(alternate)
            && !reservedPrimary.has(alternate)
        ) {
            alternateCounts.set(alternate, (alternateCounts.get(alternate) ?? 0) + 1);
        }
    }
    return new Map(features.map((entry) => {
        const properties = entry.properties ?? {};
        const primary = sourceText(properties.ISO_A3);
        const alternate = sourceText(properties.ISO_A3_EH);
        const adm0 = sourceText(properties.ADM0_A3);
        const sourceId = sourceText(properties.NE_ID);
        if (validIsoAlpha3(primary)) {
            return [sourceId, { canonicalKey: primary, codeSource: "ISO_A3" }];
        }
        if (
            validIsoAlpha3(alternate)
            && !reservedPrimary.has(alternate)
            && alternateCounts.get(alternate) === 1
        ) {
            return [sourceId, { canonicalKey: alternate, codeSource: "ISO_A3_EH" }];
        }
        if (!validIsoAlpha3(adm0)) {
            throw new Error(`Natural Earth ${sourceId} has no valid canonical source identifier.`);
        }
        return [sourceId, { canonicalKey: `NE:${adm0}`, codeSource: "ADM0_A3" }];
    }));
}

function retainedProperties(source, properties, worldAssignment) {
    if (source.kind === "world") {
        if (!worldAssignment) {
            throw new Error("Natural Earth canonical key assignment is missing.");
        }
        return {
            canonicalKey: worldAssignment.canonicalKey,
            codeSource: worldAssignment.codeSource,
            sourceId: `NE:${sourceText(properties.NE_ID)}`,
            name: sourceText(properties.NAME),
            status: sourceText(properties.TYPE),
            region: "world",
            fallback: worldAssignment.codeSource === "ADM0_A3",
            labelAnchor: finitePoint(
                [Number(properties.LABEL_X), Number(properties.LABEL_Y)],
                `${source.id}:${worldAssignment.canonicalKey} label anchor`
            ),
            labelRank: Number(properties.LABELRANK)
        };
    }
    const key = sourceText(properties.GEOID);
    const stateCode = source.kind === "county" ? sourceText(properties.STATEFP) : key;
    return {
        canonicalKey: key,
        sourceId: source.kind === "county" ? `CENSUS:COUNTY:${key}` : `CENSUS:STATE:${key}`,
        name: sourceText(properties.NAME),
        status: sourceText(properties.STUSPS),
        codeSource: "GEOID",
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

function manifestFor(source, features, payloadHash, layerCounts, layerVertexCounts, archives) {
    const fallbackKeys = features
        .filter((entry) => entry.properties.fallback)
        .map((entry) => entry.properties.canonicalKey)
        .sort(compareKeys);
    const alternateIsoKeys = features
        .filter((entry) => entry.properties.codeSource === "ISO_A3_EH")
        .map((entry) => entry.properties.canonicalKey)
        .sort(compareKeys);
    return {
        schemaVersion: 2,
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
            : "U.S. Census Bureau, 2025 Cartographic Boundary Files. Insets reposition "
                + "and rescale Alaska, Hawaii, Puerto Rico, USVI, American Samoa, Guam, "
                + "and Northern Mariana Islands; inset distance and area are not comparable.",
        policyId: source.kind === "world" ? "natural-earth-de-facto-v1" : "us-territory-insets-v1",
        sourceArchiveSha256: source.sha256,
        sourceArchives: archives.map((entry) => ({
            id: entry.id,
            sha256: entry.sha256,
            bytes: entry.bytes,
            license: entry.license,
            retainedFields: entry.retainedFields
        })),
        artifactSha256: payloadHash,
        fallbackKeys,
        alternateIsoKeys,
        layerCounts,
        layerVertexCounts
    };
}

function stableGeometryKey(entry) {
    return JSON.stringify(entry.geometry);
}

function normalizedSphericalArea(entry) {
    const area = geoArea(entry);
    return Math.min(area, Math.PI * 4 - area);
}

function countCoordinateVertices(value) {
    if (!Array.isArray(value)) return 0;
    if (
        value.length >= 2
        && typeof value[0] === "number"
        && typeof value[1] === "number"
    ) {
        return 1;
    }
    return value.reduce((sum, item) => sum + countCoordinateVertices(item), 0);
}

function countObject(topologyValue, object) {
    const decoded = feature(topologyValue, object);
    const features = decoded.type === "FeatureCollection" ? decoded.features : [decoded];
    return {
        count: features.length,
        vertices: features.reduce(
            (sum, entry) => sum + countCoordinateVertices(entry.geometry?.coordinates),
            0
        )
    };
}

function sphereFeature() {
    const ring = [];
    for (let latitude = -90; latitude <= 90; latitude += 5) ring.push([-180, latitude]);
    for (let longitude = -175; longitude <= 180; longitude += 5) ring.push([longitude, 90]);
    for (let latitude = 85; latitude >= -90; latitude -= 5) ring.push([180, latitude]);
    for (let longitude = 175; longitude >= -180; longitude -= 5) ring.push([longitude, -90]);
    ring.push(ring[0]);
    return {
        type: "Feature",
        properties: { id: "sphere" },
        geometry: { type: "Polygon", coordinates: [ring] }
    };
}

function labelZoom(rank) {
    if (rank <= 18) return 1;
    if (rank <= 50) return 1.5;
    if (rank <= 100) return 2;
    return 3;
}

async function worldReferenceInputs(source, sourceFeatures, value) {
    let sourceTopology = topology({
        features: { type: "FeatureCollection", features: sourceFeatures }
    }, 100000);
    sourceTopology = presimplify(sourceTopology);
    sourceTopology = simplify(
        sourceTopology,
        quantile(sourceTopology, source.detail === "110m" ? 0.1 : 0.03)
    );
    if (!sourceTopology.transform) sourceTopology = quantize(sourceTopology, 100000);
    const decoded = feature(sourceTopology, sourceTopology.objects.features);
    const land = merge(sourceTopology, sourceTopology.objects.features.geometries);
    const coastline = mesh(
        sourceTopology,
        sourceTopology.objects.features,
        (left, right) => left === right
    );
    const admin0 = mesh(
        sourceTopology,
        sourceTopology.objects.features,
        (left, right) => left !== right
    );
    const lakeSource = (value.physicalSources ?? []).find(
        (candidate) => candidate.id === source.lakeSourceId
    );
    if (!lakeSource) {
        throw new Error(`${source.id} is missing pinned lake source ${source.lakeSourceId}.`);
    }
    const lakes = await readShapefile(lakeSource);
    if (lakes.features.length !== lakeSource.expectedFeatures) {
        throw new Error(
            `${lakeSource.id} feature count changed: `
            + `${lakes.features.length} != ${lakeSource.expectedFeatures}`
        );
    }
    const waterFeatures = lakes.features
        .filter((entry) => entry.geometry)
        .map((entry, index) => ({
            type: "Feature",
            properties: { id: `lake:${String(index + 1).padStart(4, "0")}` },
            geometry: entry.geometry
        }))
        .sort((left, right) => {
            const areaOrder = normalizedSphericalArea(right) - normalizedSphericalArea(left);
            return areaOrder || compareKeys(stableGeometryKey(left), stableGeometryKey(right));
        })
        .map((entry, index) => ({
            ...entry,
            properties: { id: `lake:${String(index + 1).padStart(4, "0")}` }
        }));
    const labels = sourceFeatures
        .map((entry) => ({
            key: entry.properties.canonicalKey,
            text: entry.properties.name,
            anchor: entry.properties.labelAnchor,
            sourceRank: Number.isFinite(entry.properties.labelRank)
                ? entry.properties.labelRank
                : Number.MAX_SAFE_INTEGER,
            area: normalizedSphericalArea(entry)
        }))
        .sort((left, right) =>
            left.sourceRank - right.sourceRank
            || right.area - left.area
            || compareKeys(left.key, right.key))
        .map((entry, index) => ({
            key: entry.key,
            text: entry.text,
            anchor: entry.anchor,
            rank: index + 1,
            minZoom: labelZoom(index + 1)
        }))
        .sort((left, right) => compareKeys(left.key, right.key));
    return {
        decodedFeatures: decoded.features,
        labels,
        archives: [source, lakeSource],
        objects: {
            sphere: { type: "FeatureCollection", features: [sphereFeature()] },
            land: {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    properties: { id: "land" },
                    geometry: land
                }]
            },
            water: { type: "FeatureCollection", features: waterFeatures },
            coastline: {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    properties: { id: "coastline" },
                    geometry: coastline
                }]
            },
            admin0: {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    properties: { id: "admin0" },
                    geometry: admin0
                }]
            },
            graticule: {
                type: "FeatureCollection",
                features: [{
                    type: "Feature",
                    properties: { id: "graticule-10-degree" },
                    geometry: geoGraticule10()
                }]
            }
        }
    };
}

async function buildSource(source, value) {
    const collection = await readShapefile(source);
    if (collection.type !== "FeatureCollection") {
        throw new Error(`${source.id} did not parse as a FeatureCollection.`);
    }
    if (collection.features.length !== source.expectedFeatures) {
        throw new Error(
            `${source.id} feature count changed: ${collection.features.length} != ${source.expectedFeatures}`
        );
    }
    const worldAssignments = source.kind === "world"
        ? worldKeyAssignments(collection.features)
        : null;
    const sourceFeatures = collection.features.map((entry) => {
        if (!entry.geometry) {
            throw new Error(`${source.id} contains null geometry.`);
        }
        const rawProperties = entry.properties ?? {};
        const properties = retainedProperties(
            source,
            rawProperties,
            worldAssignments?.get(sourceText(rawProperties.NE_ID))
        );
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

    const references = source.kind === "world"
        ? await worldReferenceInputs(source, sourceFeatures, value)
        : usReferenceInputs(source, sourceFeatures);
    let packedTopology = topology({
        features: {
            type: "FeatureCollection",
            features: references?.decodedFeatures ?? sourceFeatures
        },
        ...references.objects
    }, 100000);
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

    const layerCounts = {};
    const layerVertexCounts = {};
    for (const [name, object] of Object.entries(packedTopology.objects)) {
        const measured = countObject(packedTopology, object);
        layerCounts[name] = measured.count;
        layerVertexCounts[name] = measured.vertices;
    }
    const labels = references.labels;
    const payload = {
        topology: packedTopology,
        labels,
        ...(references.insets ? { insets: references.insets } : {})
    };
    const payloadHash = sha256(Buffer.from(JSON.stringify(payload)));
    const output = {
        manifest: manifestFor(
            source,
            sourceFeatures,
            payloadHash,
            layerCounts,
            layerVertexCounts,
            references.archives ?? [source]
        ),
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
        const contents = await buildSource(source, value);
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
    if (parsed.manifest.schemaVersion !== 2 || parsed.manifest.id !== source.id) {
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
    const payloadHash = sha256(Buffer.from(JSON.stringify({
        topology: parsed.topology,
        labels: parsed.labels,
        ...(parsed.insets ? { insets: parsed.insets } : {})
    })));
    if (payloadHash !== parsed.manifest.artifactSha256) {
        throw new Error(`${source.id} payload hash is invalid.`);
    }
    const collection = feature(parsed.topology, parsed.topology.objects.features);
    if (collection.features.length !== source.expectedFeatures) {
        throw new Error(`${source.id} decoded feature count is invalid.`);
    }
    const keys = new Set();
    const fallbackKeys = [];
    const alternateIsoKeys = [];
    const measuredLayerCounts = {};
    const measuredLayerVertices = {};
    for (const [name, object] of Object.entries(parsed.topology.objects)) {
        const measured = countObject(parsed.topology, object);
        measuredLayerCounts[name] = measured.count;
        measuredLayerVertices[name] = measured.vertices;
    }
    if (JSON.stringify(measuredLayerCounts) !== JSON.stringify(parsed.manifest.layerCounts)) {
        throw new Error(`${source.id} layer-count manifest is stale.`);
    }
    if (
        JSON.stringify(measuredLayerVertices)
        !== JSON.stringify(parsed.manifest.layerVertexCounts)
    ) {
        throw new Error(`${source.id} layer-vertex manifest is stale.`);
    }
    const totalVertices = Object.values(measuredLayerVertices).reduce(
        (sum, count) => sum + count,
        0
    );
    if (totalVertices > source.budgets.vertices) {
        throw new Error(
            `${source.id} exceeds vertex budget: ${totalVertices} > ${source.budgets.vertices}`
        );
    }
    if (source.kind === "world") {
        const expectedLayers = ["features", "sphere", "land", "water", "coastline", "admin0", "graticule"];
        for (const name of expectedLayers) {
            if (!parsed.topology.objects[name] || measuredLayerCounts[name] < 1) {
                throw new Error(`${source.id} is missing required ${name} layer.`);
            }
        }
        if (!Array.isArray(parsed.labels) || parsed.labels.length !== source.expectedFeatures) {
            throw new Error(`${source.id} label coverage is invalid.`);
        }
        const labelKeys = parsed.labels.map((entry) => entry.key);
        if (
            new Set(labelKeys).size !== labelKeys.length
            || JSON.stringify(labelKeys) !== JSON.stringify([...labelKeys].sort(compareKeys))
        ) {
            throw new Error(`${source.id} labels must have unique stable keys.`);
        }
        for (const label of parsed.labels) {
            finitePoint(label.anchor, `${source.id}:${label.key} label anchor`);
            if (
                !Number.isInteger(label.rank)
                || label.rank < 1
                || !Number.isFinite(label.minZoom)
            ) {
                throw new Error(`${source.id}:${label.key} label metadata is invalid.`);
            }
        }
    } else {
        const expectedLayers = source.kind === "county"
            ? ["features", "land", "coastline", "admin1", "admin2"]
            : ["features", "land", "coastline", "admin1"];
        for (const name of expectedLayers) {
            if (!parsed.topology.objects[name] || measuredLayerCounts[name] < 1) {
                throw new Error(`${source.id} is missing required ${name} layer.`);
            }
        }
        const expectedLabels = source.kind === "county"
            ? source.expectedFeatures + expectedStateCodes.length
            : source.expectedFeatures;
        if (!Array.isArray(parsed.labels) || parsed.labels.length !== expectedLabels) {
            throw new Error(`${source.id} label coverage is invalid.`);
        }
        if (!Array.isArray(parsed.insets) || parsed.insets.length !== usInsets.length) {
            throw new Error(`${source.id} inset-frame coverage is invalid.`);
        }
        for (const inset of parsed.insets) {
            if (
                !usInsets.some((expected) => expected.id === inset.id)
                || !Array.isArray(inset.bounds)
                || inset.bounds.length !== 4
                || inset.bounds.some((value) => !Number.isFinite(value))
            ) {
                throw new Error(`${source.id} inset metadata is invalid.`);
            }
        }
        const labelKeys = parsed.labels.map((entry) => entry.key);
        if (
            new Set(labelKeys).size !== labelKeys.length
            || JSON.stringify(labelKeys) !== JSON.stringify([...labelKeys].sort(compareKeys))
        ) {
            throw new Error(`${source.id} labels must have unique stable keys.`);
        }
        for (const label of parsed.labels) {
            finitePoint(label.anchor, `${source.id}:${label.key} label anchor`);
            if (!label.region || !Number.isFinite(label.minZoom)) {
                throw new Error(`${source.id}:${label.key} label metadata is invalid.`);
            }
        }
    }
    for (const entry of collection.features) {
        const properties = entry.properties;
        const key = properties.canonicalKey;
        if (keys.has(key)) {
            throw new Error(`${source.id} decoded duplicate key ${key}.`);
        }
        keys.add(key);
        if (properties.fallback) fallbackKeys.push(key);
        if (properties.codeSource === "ISO_A3_EH") alternateIsoKeys.push(key);
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
    alternateIsoKeys.sort(compareKeys);
    if (JSON.stringify(fallbackKeys) !== JSON.stringify(parsed.manifest.fallbackKeys)) {
        throw new Error(`${source.id} fallback-key manifest does not match generated source policy.`);
    }
    if (JSON.stringify(alternateIsoKeys) !== JSON.stringify(parsed.manifest.alternateIsoKeys)) {
        throw new Error(`${source.id} alternate-ISO manifest does not match generated source policy.`);
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
    const budget = source.budgets;
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
    if (value.schemaVersion !== 2) {
        throw new Error(`Context source catalog schema ${value.schemaVersion} is unsupported.`);
    }
    for (const [name, version] of Object.entries(value.toolchain)) {
        const actual = packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name];
        if (actual !== version) {
            throw new Error(`Context pack tool ${name} must be pinned to ${version}; received ${actual}.`);
        }
        for (const source of allSources(value)) {
            const cached = await readFile(join(cacheDirectory, source.filename));
            verifySource(source, cached);
            if (
                !source.shapefileBase
                || !Array.isArray(source.retainedFields)
                || typeof source.license !== "string"
                || !source.budgets
            ) {
                throw new Error(`${source.id} source policy is incomplete.`);
            }
            if (
                JSON.stringify(source.retainedFields)
                !== JSON.stringify(requiredRetainedFields(source))
            ) {
                throw new Error(`${source.id} retained-field allowlist is not exact.`);
            }
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
