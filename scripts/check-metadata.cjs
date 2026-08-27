/**
 * Certification metadata guard.
 *
 * Checks the facts that Partner Center and the certification reviewers check by hand: version
 * alignment, the exact pinned API version, empty privileges, no on-object claim, no external
 * dependencies, and complete localization for every key that capabilities and the code reference.
 *
 * Usage: node scripts/check-metadata.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const EXPECTED_API_VERSION = "5.11.0";

const problems = [];

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function check(condition, message) {
    if (!condition) {
        problems.push(message);
    }
}

const packageJson = readJson("package.json");
const manifest = readJson("pbiviz.json");
const capabilities = readJson("capabilities.json");
const resources = readJson(path.join("stringResources", "en-US", "resources.resjson"));

check(
    manifest.visual.version === `${packageJson.version}.1`,
    `pbiviz visual version ${manifest.visual.version} must be package version ${packageJson.version} plus ".1".`
);
check(
    manifest.apiVersion === EXPECTED_API_VERSION,
    `pbiviz apiVersion must be exactly ${EXPECTED_API_VERSION}, found ${manifest.apiVersion}.`
);
check(
    packageJson.dependencies["powerbi-visuals-api"] === EXPECTED_API_VERSION,
    `powerbi-visuals-api must be pinned to exactly ${EXPECTED_API_VERSION}.`
);
const installedApi = readJson(path.join("node_modules", "powerbi-visuals-api", "package.json"));
check(
    installedApi.version === EXPECTED_API_VERSION,
    `installed powerbi-visuals-api is ${installedApi.version}, expected ${EXPECTED_API_VERSION}.`
);
check(packageJson.license === "MIT", "package.json license must be MIT.");
check(fs.existsSync(path.join(root, "LICENSE")), "LICENSE file is missing.");
check(manifest.dependencies === null, "pbiviz.json must declare no external visual dependencies.");
check(
    Array.isArray(manifest.externalJS) && manifest.externalJS.length === 0,
    "pbiviz.json externalJS must be an empty array."
);
check(
    Array.isArray(capabilities.privileges) && capabilities.privileges.length === 0,
    "capabilities privileges must be an empty array."
);
check(
    capabilities.supportsOnObjectFormatting === undefined
    && capabilities.enablePointerEventsFormatMode === undefined,
    "on-object formatting must not be claimed until the sub-selection APIs are implemented."
);
check(
    fs.existsSync(path.join(root, manifest.assets.icon)),
    `icon asset ${manifest.assets.icon} is missing.`
);
check(fs.existsSync(path.join(root, manifest.style)), `style file ${manifest.style} is missing.`);
for (const resource of manifest.stringResources ?? []) {
    check(fs.existsSync(path.join(root, resource)), `string resource ${resource} is missing.`);
}

// Every localized key that capabilities references must exist in the resource file.
const referencedKeys = new Set();
(function collectKeys(node) {
    if (Array.isArray(node)) {
        node.forEach(collectKeys);
        return;
    }
    if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
            if ((key === "displayNameKey" || key === "descriptionKey") && typeof value === "string") {
                referencedKeys.add(value);
            } else {
                collectKeys(value);
            }
        }
    }
})(capabilities);

for (const key of [...referencedKeys].sort()) {
    check(
        Object.prototype.hasOwnProperty.call(resources, key),
        `capabilities references localization key "${key}" that is missing from resources.resjson.`
    );
}

// Every default string in the code must exist in the resource file, and vice versa.
const localizationSource = fs.readFileSync(path.join(root, "src", "localization.ts"), "utf8");
const defaultsBlock = localizationSource.slice(
    localizationSource.indexOf("export const DEFAULT_STRINGS"),
    localizationSource.indexOf("} as const;")
);
const codeKeys = [...defaultsBlock.matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)].map((match) => match[1]);
check(codeKeys.length > 0, "could not read DEFAULT_STRINGS from src/localization.ts.");
for (const key of codeKeys) {
    check(
        Object.prototype.hasOwnProperty.call(resources, key),
        `code references localization key "${key}" that is missing from resources.resjson.`
    );
}
const knownKeys = new Set([...codeKeys, ...referencedKeys]);
for (const key of Object.keys(resources)) {
    check(knownKeys.has(key), `resources.resjson declares unused key "${key}".`);
}

// The formatting model must address the exact capability object and property names.
const formattingSource = fs.readFileSync(path.join(root, "src", "formatting.ts"), "utf8");
const cardBlocks = formattingSource.split(/export class /).slice(1);
const declaredCards = new Map();
for (const block of cardBlocks) {
    const cardName = block.match(/public override name = "([A-Za-z0-9]+)"/);
    if (!cardName) {
        continue;
    }
    const sliceNames = [...block.matchAll(/name: "([A-Za-z0-9]+)"/g)].map((match) => match[1]);
    declaredCards.set(cardName[1], new Set(sliceNames));
}

for (const [objectName, object] of Object.entries(capabilities.objects ?? {})) {
    const card = declaredCards.get(objectName);
    check(card !== undefined, `capabilities object "${objectName}" has no formatting card.`);
    if (!card) {
        continue;
    }
    for (const propertyName of Object.keys(object.properties ?? {})) {
        check(
            card.has(propertyName),
            `capabilities property "${objectName}.${propertyName}" has no formatting slice.`
        );
    }
}
for (const [cardName, slices] of declaredCards.entries()) {
    const object = (capabilities.objects ?? {})[cardName];
    check(object !== undefined, `formatting card "${cardName}" has no capabilities object.`);
    if (!object) {
        continue;
    }
    for (const slice of slices) {
        check(
            Object.prototype.hasOwnProperty.call(object.properties ?? {}, slice),
            `formatting slice "${cardName}.${slice}" has no capabilities property.`
        );
    }
}

if (problems.length > 0) {
    console.error("Certification metadata check failed:");
    for (const problem of problems) {
        console.error(`  - ${problem}`);
    }
    process.exitCode = 1;
} else {
    console.log(
        `Certification metadata check passed for ${manifest.visual.name} ${manifest.visual.version} `
        + `on API ${manifest.apiVersion}.`
    );
}
