const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { acquirePbixPublicationLock } = require("./pbix-publication-lock.cjs");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const evidencePath = path.join(
    root,
    "docs",
    "native-validation",
    `${manifest.visual.name}-${manifest.visual.version}.json`
);
const evidence = fs.existsSync(evidencePath)
    ? JSON.parse(fs.readFileSync(evidencePath, "utf8"))
    : null;
const pbixPath = path.join(
    root,
    "dist",
    "release",
    `AtlynProfileLensSample-${manifest.visual.version}.pbix`
);

function runWorker() {
    return new Promise((resolve, reject) => {
        const worker = spawn(process.execPath, [
            path.join(root, "scripts", "release-manifest-worker.cjs")
        ], { cwd: root, stdio: "inherit", windowsHide: true });
        worker.once("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Release manifest worker exited ${code}.`));
        });
    });
}

(async () => {
    const pbixExistedBeforeWorker = fs.existsSync(pbixPath);
    const lock = pbixExistedBeforeWorker
        ? await acquirePbixPublicationLock(root, pbixPath)
        : null;
    try {
        if (lock) await lock.verifyAlive();
        await runWorker();
        if (lock) await lock.verifyAlive();
        if (!lock) {
            const outputPath = path.join(root, "dist", "release-manifest.json");
            const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
            if (fs.existsSync(pbixPath) || output.submission?.sampleReport?.pbix !== null) {
                fs.rmSync(outputPath, { force: true });
                throw new Error("PBIX appeared during an unlocked manifest run.");
            }
        }
    } catch (error) {
        fs.rmSync(path.join(root, "dist", "release-manifest.json"), { force: true });
        throw error;
    } finally {
        if (lock) await lock.release().catch(() => {});
    }
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
