/**
 * Forbidden call scan.
 *
 * Certified visuals may not make external requests, evaluate dynamic code, inject markup, or
 * persist report data in the browser
 * (https://learn.microsoft.com/en-us/power-bi/developer/visuals/power-bi-custom-visuals-certified).
 * This scans the TypeScript sources and, when a package exists, the packaged bundle that would
 * actually ship.
 *
 * Usage: node scripts/scan-forbidden-calls.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

const root = path.resolve(__dirname, "..");

const RULES = [
    { name: "fetch", pattern: /\bfetch\s*\(/ },
    { name: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/ },
    { name: "WebSocket", pattern: /\bWebSocket\b/ },
    { name: "EventSource", pattern: /\bEventSource\b/ },
    { name: "navigator.sendBeacon", pattern: /sendBeacon\s*\(/ },
    { name: "eval", pattern: /\beval\s*\(/ },
    { name: "new Function", pattern: /new\s+Function\s*\(/ },
    { name: "innerHTML", pattern: /\.innerHTML\b/ },
    { name: "outerHTML", pattern: /\.outerHTML\s*=/ },
    { name: "insertAdjacentHTML", pattern: /insertAdjacentHTML\s*\(/ },
    { name: "document.write", pattern: /document\.write\s*\(/ },
    { name: "localStorage", pattern: /\blocalStorage\b/ },
    { name: "sessionStorage", pattern: /\bsessionStorage\b/ },
    { name: "indexedDB", pattern: /\bindexedDB\b/ },
    { name: "document.cookie", pattern: /document\.cookie\b/ },
    { name: "importScripts", pattern: /\bimportScripts\s*\(/ },
    { name: "setInterval", pattern: /\bsetInterval\s*\(/ },
    { name: "http(s) URL literal", pattern: /["'`]https?:\/\/(?!www\.w3\.org)/ }
];

const problems = [];

function scanText(label, text) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
        for (const rule of RULES) {
            if (rule.pattern.test(line)) {
                problems.push(`${label}:${index + 1} uses ${rule.name}`);
            }
        }
    });
}

function walk(directory, extensions) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(full, extensions));
        } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
            files.push(full);
        }
    }
    return files;
}

for (const file of walk(path.join(root, "src"), [".ts"])) {
    scanText(path.relative(root, file), fs.readFileSync(file, "utf8"));
}

async function scanPackagedBundle() {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
    const packagePath = path.join(
        root,
        "dist",
        `${manifest.visual.name}.${manifest.visual.version}.pbiviz`
    );
    if (!fs.existsSync(packagePath)) {
        return;
    }
    const zip = await JSZip.loadAsync(fs.readFileSync(packagePath));
    const resourcePath = `resources/${manifest.visual.guid}.pbiviz.json`;
    const resource = zip.file(resourcePath);
    if (!resource) {
        problems.push(`packaged bundle is missing ${resourcePath}`);
        return;
    }
    const parsed = JSON.parse(await resource.async("string"));
    const js = parsed.content?.js ?? "";
    // Bundled library code legitimately mentions some names in dead branches, so only the
    // network and dynamic code rules are enforced on the shipped bundle.
    for (const rule of RULES.slice(0, 7)) {
        if (rule.pattern.test(js)) {
            problems.push(`packaged bundle uses ${rule.name}`);
        }
    }
}

function finish() {
    if (problems.length > 0) {
        console.error("Forbidden call scan failed:");
        for (const problem of problems) {
            console.error(`  - ${problem}`);
        }
        process.exitCode = 1;
    } else {
        console.log("Forbidden call scan passed: no network, dynamic code, markup injection or browser storage use.");
    }
}

scanPackagedBundle().then(finish).catch((error) => {
    console.error(`Forbidden call scan failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
