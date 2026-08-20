const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DESKTOP_DIRECTORY_LIMIT = 248;
const DESKTOP_FILE_LIMIT = 260;
const SNAPSHOT_FOLDER = "AtlynPBI";
const SHORT_TOKEN_LENGTH = 20;
const DESKTOP_CREATED_PATHS = [
    "AtlynProfileLensSample.Report/.pbi/localSettings.json",
    "AtlynProfileLensSample.SemanticModel/.pbi/localSettings.json",
    "AtlynProfileLensSample.SemanticModel/.pbi/editorSettings.json"
];

function sha256(bytes) {
    return crypto.createHash("sha256").update(bytes).digest("hex");
}

function manifest(directory, excluded = new Set()) {
    const files = [];
    function walk(current) {
        for (const entry of fs.readdirSync(current).sort()) {
            const absolute = path.join(current, entry);
            const status = fs.lstatSync(absolute);
            if (status.isSymbolicLink()) {
                throw new Error("Native snapshot source and destination cannot contain reparse links.");
            }
            if (status.isDirectory()) {
                walk(absolute);
                continue;
            }
            const bytes = fs.readFileSync(absolute);
            const relativePath = path.relative(directory, absolute).split(path.sep).join("/");
            if (excluded.has(relativePath)) continue;
            files.push({
                path: relativePath,
                bytes: bytes.length,
                sha256: sha256(bytes)
            });
        }
    }
    walk(directory);
    const canonical = files.map(
        (file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`
    ).join("");
    return {
        files: files.length,
        bytes: files.reduce((total, file) => total + file.bytes, 0),
        sha256: sha256(Buffer.from(canonical, "utf8")),
        entries: files
    };
}

function allowedDirectoryEntries(entries) {
    const allowedFiles = new Set(DESKTOP_CREATED_PATHS);
    const allowedDirectories = new Set();
    for (const entry of [...entries.map((item) => item.path), ...DESKTOP_CREATED_PATHS]) {
        let current = path.posix.dirname(entry);
        while (current !== ".") {
            allowedDirectories.add(current);
            current = path.posix.dirname(current);
        }
    }
    return { allowedFiles, allowedDirectories };
}

function assertSnapshotDirectoryEntries(directory, entries) {
    const { allowedFiles, allowedDirectories } = allowedDirectoryEntries(entries);
    function walk(current) {
        for (const entry of fs.readdirSync(current).sort()) {
            const absolute = path.join(current, entry);
            const relative = path.relative(directory, absolute).split(path.sep).join("/");
            const status = fs.lstatSync(absolute);
            if (status.isSymbolicLink()) {
                throw new Error("Native snapshot cannot contain reparse links.");
            }
            if (status.isDirectory()) {
                if (!allowedDirectories.has(relative)) {
                    throw new Error(`Native snapshot contains an unexpected directory: ${relative}`);
                }
                walk(absolute);
                continue;
            }
            if (!entries.some((item) => item.path === relative) && !allowedFiles.has(relative)) {
                throw new Error(`Native snapshot contains an unexpected file: ${relative}`);
            }
        }
    }
    walk(directory);
}

function snapshotParent(options = {}) {
    const configured = options.snapshotParent ??
        path.join(options.localAppData ?? process.env.LOCALAPPDATA ?? "", SNAPSHOT_FOLDER);
    if (!configured || !path.isAbsolute(configured)) {
        throw new Error("A trusted absolute LOCALAPPDATA snapshot root is required.");
    }
    return path.resolve(configured);
}

function snapshotDirectory(token, options = {}) {
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Snapshot token is invalid.");
    const parent = snapshotParent(options);
    const directory = path.join(parent, token.slice(0, SHORT_TOKEN_LENGTH));
    if (path.dirname(directory) !== parent) {
        throw new Error("Native snapshot escaped its allowlisted short root.");
    }
    return directory;
}

function assertNoReparsePoint(target, stopAt) {
    let current = path.resolve(target);
    const boundary = path.resolve(stopAt);
    while (current.startsWith(`${boundary}${path.sep}`) || current === boundary) {
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
            throw new Error("Native snapshot root cannot use a junction, symlink, or reparse point.");
        }
        if (current === boundary) return;
        current = path.dirname(current);
    }
    throw new Error("Native snapshot path is outside its allowlisted short root.");
}

function projectedLaunchPaths(directory, entries) {
    return [
        ...entries.map((entry) => path.join(directory, ...entry.path.split("/"))),
        ...DESKTOP_CREATED_PATHS.map((entry) => path.join(directory, ...entry.split("/")))
    ];
}

function assertDesktopPathHeadroom(directory, entries) {
    const paths = projectedLaunchPaths(directory, entries);
    for (const filename of paths) {
        if (filename.length >= DESKTOP_FILE_LIMIT) {
            throw new Error(
                `Desktop launch snapshot file path requires ${filename.length} characters; ` +
                `the safe limit is ${DESKTOP_FILE_LIMIT - 1}.`
            );
        }
        let parent = path.dirname(filename);
        while (parent.startsWith(`${directory}${path.sep}`) || parent === directory) {
            if (parent.length >= DESKTOP_DIRECTORY_LIMIT) {
                throw new Error(
                    `Desktop launch snapshot directory path requires ${parent.length} characters; ` +
                    `the safe limit is ${DESKTOP_DIRECTORY_LIMIT - 1}.`
                );
            }
            if (parent === directory) break;
            parent = path.dirname(parent);
        }
    }
    return {
        projectedPaths: paths.length,
        longestFilePath: Math.max(...paths.map((entry) => entry.length)),
        fileLimitExclusive: DESKTOP_FILE_LIMIT,
        directoryLimitExclusive: DESKTOP_DIRECTORY_LIMIT,
        desktopCreatedPaths: DESKTOP_CREATED_PATHS
    };
}

function createSnapshot(root, options = {}) {
    const source = path.join(root, "samples", "AtlynProfileLensSample");
    const sourceManifest = manifest(source);
    const fixtureProjectTree = manifest(source, new Set(["sample-integrity.json"]));
    const token = sourceManifest.sha256;
    const parent = snapshotParent(options);
    const destination = snapshotDirectory(token, options);
    const staging = path.join(parent, `.${token.slice(0, SHORT_TOKEN_LENGTH)}`);
    const pathPreflight = assertDesktopPathHeadroom(destination, sourceManifest.entries);
    assertDesktopPathHeadroom(staging, sourceManifest.entries);
    fs.mkdirSync(parent, { recursive: true });
    assertNoReparsePoint(parent, parent);
    if (fs.existsSync(destination)) {
        assertNoReparsePoint(destination, parent);
        const existing = manifest(destination, new Set(DESKTOP_CREATED_PATHS));
        assertSnapshotDirectoryEntries(destination, existing.entries);
        if (existing.sha256 !== token) {
            throw new Error("Native snapshot short content token collision detected.");
        }
        fs.rmSync(destination, { recursive: true, force: true });
    }
    fs.rmSync(staging, { recursive: true, force: true });
    try {
        fs.cpSync(source, staging, {
            recursive: true,
            force: false,
            verbatimSymlinks: true
        });
        assertNoReparsePoint(staging, parent);
        const copied = manifest(staging);
        if (JSON.stringify(copied) !== JSON.stringify(sourceManifest)) {
            throw new Error("Native snapshot copy differs from the verified PBIP source.");
        }
        fs.renameSync(staging, destination);
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
    return {
        token,
        logicalPath: `localappdata/${SNAPSHOT_FOLDER}/${token.slice(0, SHORT_TOKEN_LENGTH)}`,
        absolutePath: destination,
        pbip: "AtlynProfileLensSample.pbip",
        manifest: sourceManifest,
        fixtureProjectTreeSha256: fixtureProjectTree.sha256,
        pathPreflight
    };
}

function verifySnapshot(root, token, expectedSha256 = token, options = {}) {
    if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("Snapshot token is invalid.");
    if (expectedSha256 !== token) throw new Error("Snapshot token and expected hash differ.");
    const directory = snapshotDirectory(token, options);
    const parent = snapshotParent(options);
    assertNoReparsePoint(directory, parent);
    const current = manifest(directory, new Set(DESKTOP_CREATED_PATHS));
    if (current.sha256 !== token) throw new Error("Native snapshot changed.");
    assertSnapshotDirectoryEntries(directory, current.entries);
    return {
        token,
        logicalPath: `localappdata/${SNAPSHOT_FOLDER}/${token.slice(0, SHORT_TOKEN_LENGTH)}`,
        absolutePath: directory,
        pbip: "AtlynProfileLensSample.pbip",
        manifest: current,
        fixtureProjectTreeSha256: manifest(
            directory,
            new Set(["sample-integrity.json"])
        ).sha256,
        pathPreflight: assertDesktopPathHeadroom(directory, current.entries)
    };
}

function removeSnapshot(root, token, options = {}) {
    const directory = snapshotDirectory(token, options);
    if (!fs.existsSync(directory)) {
        return { token, removed: false, alreadyAbsent: true };
    }
    const verified = verifySnapshot(root, token, token, options);
    fs.rmSync(verified.absolutePath, { recursive: true, force: true });
    if (fs.existsSync(verified.absolutePath)) {
        throw new Error("Native launch snapshot cleanup failed.");
    }
    return { token, removed: true, alreadyAbsent: false };
}

module.exports = {
    assertDesktopPathHeadroom,
    assertSnapshotDirectoryEntries,
    createSnapshot,
    manifest,
    projectedLaunchPaths,
    removeSnapshot,
    snapshotDirectory,
    verifySnapshot
};

if (require.main === module) {
    const root = path.resolve(__dirname, "..");
    const result = process.argv[2] === "--verify"
        ? verifySnapshot(root, process.argv[3], process.argv[4])
        : process.argv[2] === "--remove"
            ? removeSnapshot(root, process.argv[3])
            : process.argv[2] === "--token"
                ? {
                    token: manifest(
                        path.join(root, "samples", "AtlynProfileLensSample")
                    ).sha256
                }
            : createSnapshot(root);
    process.stdout.write(JSON.stringify(result));
}
