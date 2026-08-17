/**
 * Structural inspection of a generated .pbiviz archive.
 *
 * A source-tree shaped archive can pass every content check while being unloadable, so the
 * container shape is asserted before anything is read out of it.
 */
function inspectPackage({ entries, fileEntries, manifest, resource, guid, version }) {
    const problems = [];
    const resourcePath = `resources/${guid}.pbiviz.json`;

    if (!entries.includes("package.json")) {
        problems.push("package.json is missing from the archive");
    }
    if (!entries.includes(resourcePath)) {
        problems.push(`${resourcePath} is missing from the archive`);
    }
    if (fileEntries.length !== 2) {
        problems.push(`archive must contain exactly two files, found ${fileEntries.length}: ${fileEntries.join(", ")}`);
    }
    if (!manifest) {
        problems.push("package.json is not valid JSON");
    } else {
        if (manifest.version !== version) {
            problems.push(`manifest version ${manifest.version} does not match ${version}`);
        }
        if (manifest.visual?.guid !== guid) {
            problems.push(`manifest guid ${manifest.visual?.guid} does not match ${guid}`);
        }
        const resourceEntry = (manifest.resources ?? []).find((item) => item.file === resourcePath);
        if (!resourceEntry) {
            problems.push("manifest does not reference the inline resource file");
        }
    }
    if (!resource) {
        problems.push("inline resource is not valid JSON");
    } else {
        if (typeof resource.content?.js !== "string" || resource.content.js.length === 0) {
            problems.push("inline resource carries no JavaScript bundle");
        }
        if (typeof resource.content?.css !== "string" || resource.content.css.length === 0) {
            problems.push("inline resource carries no compiled stylesheet");
        }
        if (typeof resource.content?.iconBase64 !== "string" || resource.content.iconBase64.length === 0) {
            problems.push("inline resource carries no icon");
        }
        if (resource.visual?.guid !== guid) {
            problems.push("inline resource guid does not match the manifest");
        }
        if (resource.apiVersion !== undefined && typeof resource.apiVersion !== "string") {
            problems.push("inline resource apiVersion is malformed");
        }
    }
    return problems;
}

module.exports = { inspectPackage };
