const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

async function acquirePbixPublicationLock(root, pbixPath) {
    const child = spawn("pwsh", [
        "-NoProfile",
        "-File",
        path.join(root, "scripts", "native-validation", "hold-pbix-lock.ps1"),
        "-Path",
        pbixPath
    ], {
        cwd: root,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const lines = readline.createInterface({ input: child.stdout });
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out acquiring PBIX lock.")), 15000);
        lines.once("line", (line) => {
            clearTimeout(timeout);
            if (line === "LOCKED") resolve();
            else reject(new Error(`PBIX lock failed: ${line}`));
        });
        child.once("exit", (code) => {
            clearTimeout(timeout);
            reject(new Error(`PBIX lock process exited ${code}: ${stderr}`));
        });
    });
    let released = false;
    return {
        async release() {
            if (released) return;
            released = true;
            child.stdin.write("\n");
            child.stdin.end();
            await new Promise((resolve, reject) => {
                child.once("exit", (code) => {
                    lines.close();
                    if (code === 0) resolve();
                    else reject(new Error(`PBIX lock release failed: ${stderr}`));
                });
            });
        }
    };
}

module.exports = { acquirePbixPublicationLock };
