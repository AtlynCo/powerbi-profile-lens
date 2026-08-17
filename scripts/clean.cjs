/**
 * Removes generated build output so every package run starts from a known state.
 *
 * Usage: node scripts/clean.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const targets = ["dist", ".tmp", "test-results", "playwright-report"];

for (const target of targets) {
    // Windows can hold a transient handle on a directory that was just written, so retry briefly
    // instead of failing the whole package run.
    fs.rmSync(path.join(root, target), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
    });
}
console.log(`Cleaned: ${targets.join(", ")}`);
