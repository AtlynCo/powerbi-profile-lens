/**
 * Certification audit of a freshly generated package.
 *
 * Everything here is asserted against the artifact that would be submitted: the archive shape, the
 * inline bundle, the compiled stylesheet, the 20x20 icon, the declared API version, and the
 * absence of privileges, external dependencies and forbidden calls.
 *
 * Usage: node scripts/certification-audit.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("jszip");
const { inspectPackage } = require("./pbiviz-structure.cjs");

const root = path.resolve(__dirname, "..");
const packageJson = readJson("package.json");
const manifest = readJson("pbiviz.json");
const capabilities = readJson(manifest.capabilities);
const packageDirectory = path.join(root, "dist");
const packageName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;
const packagePath = path.join(packageDirectory, packageName);
const runtimeLicenseSource = fs.readFileSync(
    path.join(root, "src", "runtimeLicenses.ts"),
    "utf8"
);
const runtimeLicenseMatch = runtimeLicenseSource.match(
    /export const RUNTIME_LICENSE_NOTICES = `([\s\S]*?)`;/
);
const runtimeLicenseHashMatch = runtimeLicenseSource.match(
    /RUNTIME_LICENSE_NOTICES_SHA256\s*=\s*\n?\s*"([a-f0-9]{64})"/
);

const FORBIDDEN_BUNDLE_PATTERNS = [
    { name: "fetch", pattern: /\bfetch\s*\(/ },
    { name: "XMLHttpRequest", pattern: /XMLHttpRequest/ },
    { name: "WebSocket", pattern: /\bWebSocket\b/ },
    { name: "eval", pattern: /\beval\s*\(/ },
    { name: "new Function", pattern: /new\s+Function\s*\(/ },
    { name: "localStorage", pattern: /localStorage/ },
    { name: "sessionStorage", pattern: /sessionStorage/ },
    { name: "http(s) endpoint", pattern: /["'`]https?:\/\/(?!www\.w3\.org|learn\.microsoft\.com|github\.com|atlyn\.io)/ }
];
const RUNTIME_LICENSE_MARKERS = [
    "RUNTIME-LICENSE-NOTICES-BEGIN",
    "RUNTIME-LICENSE-NOTICES-END",
    "d3-geo 3.1.1",
    "d3-array 3.2.4",
    "InternMap 2.0.3",
    "topojson-client 3.1.0",
    "powerbi-visuals-api 5.11.0",
    "powerbi-visuals-utils-formattingmodel 7.1.0",
    "semver 7.8.5",
    "commander 2.20.3",
    "Copyright 2010-2024 Mike Bostock",
    "Copyright 2008-2012 Charles Karney",
    "Copyright 2010-2023 Mike Bostock",
    "Copyright 2021 Mike Bostock",
    "Copyright 2012-2019 Michael Bostock",
    "Copyright (c) Microsoft Corporation. All rights reserved.",
    "Copyright (c) Microsoft Corporation.",
    "Copyright (c) Isaac Z. Schlueter and Contributors",
    "Copyright (c) 2011 TJ Holowaychuk",
    "Permission to use, copy, modify, and/or distribute this software for any purpose",
    "Permission is hereby granted, free of charge, to any person obtaining a copy"
];

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Certification audit failed: ${message}`);
    }
}

assert(
    manifest.visual.version === `${packageJson.version}.0`,
    "pbiviz version must match the package version"
);
assert(manifest.apiVersion === "5.11.0", "apiVersion must be exactly 5.11.0");
assert(manifest.dependencies === null, "external visual dependencies must be absent");
assert(
    Array.isArray(capabilities.privileges) && capabilities.privileges.length === 0,
    "visual privileges must be empty"
);
assert(
    capabilities.supportsOnObjectFormatting === undefined,
    "on-object formatting must not be claimed"
);
assert(
    capabilities.expandCollapse === undefined && capabilities.drilldown === undefined,
    "expand/collapse and drilldown must remain undeclared until native host proof passes"
);
assert(
    capabilities.objects?.general === undefined,
    "outward filter capability must remain absent"
);
assert(fs.existsSync(packageDirectory), "dist directory is missing");

const packages = fs.readdirSync(packageDirectory).filter((entry) => entry.endsWith(".pbiviz"));
assert(packages.length === 1, "dist must contain exactly one freshly generated PBIVIZ");
assert(packages[0] === packageName, `package filename must be ${packageName}`);
assert(fs.statSync(packagePath).size > 0, "generated PBIVIZ is empty");
assert(runtimeLicenseMatch, "canonical runtime license notice block is missing");
assert(runtimeLicenseHashMatch, "canonical runtime license notice hash is missing");
const runtimeLicenseHash = crypto
    .createHash("sha256")
    .update(runtimeLicenseMatch[1].replace(/\r\n/g, "\n"))
    .digest("hex");
assert(
    runtimeLicenseHash === runtimeLicenseHashMatch[1],
    "canonical runtime license notice hash is stale"
);
assert(
    fs.statSync(packagePath).size <= 2 * 1024 * 1024,
    "generated PBIVIZ exceeds the 2 MiB context-pack release budget"
);

const generatedMetadata = readJson(path.join("dist", "package.json"));
assert(
    generatedMetadata.version === manifest.visual.version,
    "generated package version differs from source"
);
for (const key of ["name", "displayName", "guid", "visualClassName", "version", "description"]) {
    assert(
        generatedMetadata.visual[key] === manifest.visual[key],
        `generated visual metadata differs at ${key}`
    );
}

(async () => {
    const bytes = fs.readFileSync(packagePath);
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.keys(zip.files);
    const fileEntries = entries.filter((entry) => !zip.files[entry].dir);
    const resourcePath = `resources/${manifest.visual.guid}.pbiviz.json`;

    const parseEntry = async (name) => {
        if (!entries.includes(name)) {
            return undefined;
        }
        try {
            return JSON.parse(await zip.files[name].async("string"));
        } catch {
            return undefined;
        }
    };

    const structureProblems = inspectPackage({
        entries,
        fileEntries,
        manifest: await parseEntry("package.json"),
        resource: await parseEntry(resourcePath),
        guid: manifest.visual.guid,
        version: manifest.visual.version
    });
    assert(
        structureProblems.length === 0,
        `packaged archive is not a loadable .pbiviz:\n  - ${structureProblems.join("\n  - ")}`
    );

    const resource = await parseEntry(resourcePath);
    assert(resource.apiVersion === "5.11.0", "packaged apiVersion must be 5.11.0");
    assert(
        typeof resource.content.css === "string" && resource.content.css.includes(".profile-lens"),
        "compiled stylesheet is missing from the package; src/visual.ts must import style/visual.less"
    );
    assert(
        typeof resource.capabilities === "object" && Array.isArray(resource.capabilities.privileges)
        && resource.capabilities.privileges.length === 0,
        "packaged capabilities must declare empty privileges"
    );
    assert(
        resource.capabilities.objects?.general === undefined,
        "packaged capabilities must not declare outward filter support"
    );
    const packagedInteractionModes = resource.capabilities.objects?.interaction
        ?.properties?.mode?.type?.enumeration?.map((entry) => entry.value);
    assert(
        JSON.stringify(packagedInteractionModes) === JSON.stringify(["localOnly", "reportSelection"]),
        "packaged interaction modes must be exactly localOnly and reportSelection"
    );
    assert(
        Array.isArray(resource.stringResources) || typeof resource.stringResources === "object",
        "packaged string resources are missing"
    );

    for (const rule of FORBIDDEN_BUNDLE_PATTERNS) {
        assert(
            !rule.pattern.test(resource.content.js),
            `packaged bundle uses ${rule.name}, which certification forbids`
        );
    }
    const notices = fs.readFileSync(path.join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
    for (const marker of RUNTIME_LICENSE_MARKERS) {
        assert(
            resource.content.js.includes(marker),
            `packaged runtime is missing required license text: ${marker}`
        );
        assert(
            notices.includes(marker.replace("RUNTIME-LICENSE-NOTICES-BEGIN", "d3-geo 3.1.1")
                .replace("RUNTIME-LICENSE-NOTICES-END", "commander 2.20.3")),
            `THIRD_PARTY_NOTICES is missing required license text: ${marker}`
        );
    }
    assert(
        resource.content.js.includes(runtimeLicenseHash),
        "packaged runtime is missing the canonical complete license notice hash"
    );
    assert(!/\bapplyJsonFilter\b/.test(resource.content.js), "packaged bundle uses outward filter API");

    const iconBase64 = String(resource.content.iconBase64 ?? "");
    assert(iconBase64.startsWith("data:image/png;base64,"), "packaged icon is not a base64 PNG data URI");
    const icon = Buffer.from(iconBase64.slice("data:image/png;base64,".length), "base64");
    assert(
        icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        "packaged icon is not a PNG"
    );
    assert(
        icon.readUInt32BE(16) === 20 && icon.readUInt32BE(20) === 20,
        `packaged icon must be 20x20, received ${icon.readUInt32BE(16)}x${icon.readUInt32BE(20)}`
    );

    const embeddedPath = path.join(
        root,
        "samples",
        "AtlynProfileLensSample",
        "AtlynProfileLensSample.Report",
        "CustomVisuals",
        manifest.visual.guid,
        "resources",
        `${manifest.visual.guid}.pbiviz.json`
    );
    if (fs.existsSync(embeddedPath)) {
        const embedded = fs.readFileSync(embeddedPath, "utf8");
        const packaged = await zip.files[resourcePath].async("string");
        assert(
            embedded === packaged,
            'the sample report embeds a stale visual; run "npm run sample:pbip" after packaging'
        );
    }

    console.log(`Certification audit passed for ${packageName}`);
    console.log(`SHA-256: ${crypto.createHash("sha256").update(bytes).digest("hex")}`);
})().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
});
