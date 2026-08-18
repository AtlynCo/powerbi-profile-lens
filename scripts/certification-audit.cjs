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
