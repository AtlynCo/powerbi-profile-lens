const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const INTEGRITY_FILENAME = "sample-integrity.json";

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function portable(relativePath) {
    return relativePath.split(path.sep).join("/");
}

function filesUnder(directory, relativeTo, excluded = new Set()) {
    const files = [];
    function walk(current) {
        for (const entry of fs.readdirSync(current).sort()) {
            const absolute = path.join(current, entry);
            if (fs.statSync(absolute).isDirectory()) {
                walk(absolute);
                continue;
            }
            const relative = portable(path.relative(relativeTo, absolute));
            if (!excluded.has(relative)) {
                const bytes = fs.readFileSync(absolute);
                files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
            }
        }
    }
    walk(directory);
    return files;
}

function canonicalTree(files) {
    const canonical = files
        .map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`)
        .join("");
    return {
        files: files.length,
        bytes: files.reduce((total, file) => total + file.bytes, 0),
        sha256: sha256(Buffer.from(canonical, "utf8"))
    };
}

function computeSampleIntegrity({ root, sampleRoot, generatorPath, guid }) {
    const excluded = new Set([INTEGRITY_FILENAME]);
    const projectFiles = filesUnder(sampleRoot, sampleRoot, excluded);
    const reportDefinitionRoot = path.join(
        sampleRoot,
        "AtlynProfileLensSample.Report",
        "definition"
    );
    const modelDefinitionRoot = path.join(
        sampleRoot,
        "AtlynProfileLensSample.SemanticModel",
        "definition"
    );
    const embeddedRelativePath = portable(path.join(
        "AtlynProfileLensSample.Report",
        "CustomVisuals",
        guid,
        "resources",
        `${guid}.pbiviz.json`
    ));
    const embedded = projectFiles.find((file) => file.path === embeddedRelativePath);
    if (!embedded) {
        throw new Error("Sample integrity requires the embedded custom visual resource.");
    }
    const pbip = projectFiles.find((file) => file.path === "AtlynProfileLensSample.pbip");
    if (!pbip) {
        throw new Error("Sample integrity requires the PBIP entry point.");
    }
    const generatorBytes = Buffer.from(
        fs.readFileSync(generatorPath, "utf8").replace(/\r\n/g, "\n"),
        "utf8"
    );
    return {
        schemaVersion: 1,
        projectTree: canonicalTree(projectFiles),
        reportDefinitionTree: canonicalTree(filesUnder(reportDefinitionRoot, sampleRoot)),
        modelDefinitionTree: canonicalTree(filesUnder(modelDefinitionRoot, sampleRoot)),
        generator: {
            path: portable(path.relative(root, generatorPath)),
            bytes: generatorBytes.length,
            sha256: sha256(generatorBytes)
        },
        pbip,
        embeddedVisualResource: embedded
    };
}

function writeSampleIntegrity(options) {
    const integrity = computeSampleIntegrity(options);
    fs.writeFileSync(
        path.join(options.sampleRoot, INTEGRITY_FILENAME),
        `${JSON.stringify(integrity, null, 2)}\n`
    );
    return integrity;
}

module.exports = {
    INTEGRITY_FILENAME,
    computeSampleIntegrity,
    writeSampleIntegrity
};

if (require.main === module) {
    const root = path.resolve(__dirname, "..");
    const sampleRoot = path.join(root, "samples", "AtlynProfileLensSample");
    process.stdout.write(JSON.stringify(computeSampleIntegrity({
        root,
        sampleRoot,
        generatorPath: path.join(root, "scripts", "build-sample-report.cjs"),
        guid: "atlynProfileLens"
    })));
}
