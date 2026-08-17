/**
 * Reproducible dependency install: removes node_modules and installs strictly from the lockfile.
 *
 * Usage: node scripts/clean-install.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

if (!fs.existsSync(path.join(root, "package-lock.json"))) {
    console.error("package-lock.json is missing; a clean install would not be reproducible.");
    process.exit(1);
}

fs.rmSync(path.join(root, "node_modules"), { recursive: true, force: true });

const npm = process.platform === "win32" ? process.env.ComSpec : "npm";
const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm ci --no-audit --no-fund"]
    : ["ci", "--no-audit", "--no-fund"];

const result = spawnSync(npm, args, { cwd: root, stdio: "inherit" });
if (result.status !== 0) {
    console.error(`Clean install failed with exit code ${result.status}.`);
    process.exit(result.status ?? 1);
}
console.log("Clean install completed from package-lock.json.");
