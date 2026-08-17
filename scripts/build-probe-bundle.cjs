/**
 * Extracts the compiled bundle from the generated .pbiviz so the browser probe runs the artifact
 * that would actually be submitted, not a test-only build.
 *
 * Usage: node scripts/build-probe-bundle.cjs
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const packageName = `${manifest.visual.name}.${manifest.visual.version}.pbiviz`;
const packagePath = path.join(root, "dist", packageName);
const outputDirectory = path.join(root, ".tmp", "probe");

(async () => {
    if (!fs.existsSync(packagePath)) {
        throw new Error(`${packageName} is missing. Run "npm run package" first.`);
    }
    const bytes = fs.readFileSync(packagePath);
    const zip = await JSZip.loadAsync(bytes);
    const resourceName = Object.keys(zip.files)
        .find((entry) => entry.startsWith("resources/") && entry.endsWith(".json"));
    if (!resourceName) {
        throw new Error("packaged resource descriptor is missing");
    }
    const resource = JSON.parse(await zip.files[resourceName].async("string"));
    const js = resource.content?.js ?? "";
    const css = resource.content?.css ?? "";
    if (js.length === 0) {
        throw new Error("packaged bundle contains no JavaScript");
    }

    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.writeFileSync(path.join(outputDirectory, "visual.js"), js, "utf8");
    fs.writeFileSync(path.join(outputDirectory, "visual.css"), css, "utf8");
    fs.writeFileSync(
        path.join(outputDirectory, "bundle-meta.json"),
        `${JSON.stringify({
            packageName,
            packageSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
            guid: manifest.visual.guid,
            version: manifest.visual.version,
            jsBytes: js.length,
            cssBytes: css.length
        }, null, 2)}\n`
    );
    console.log(`Extracted packaged bundle for ${packageName} (${js.length} JS bytes, ${css.length} CSS bytes)`);
})().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
});
