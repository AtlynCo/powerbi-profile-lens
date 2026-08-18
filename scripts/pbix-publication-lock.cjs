const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

async function withTimeout(promise, milliseconds, message) {
    let timer;
    const timeout = new Promise((unused, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

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
    let exitState = null;
    let locked = false;
    let released = false;
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const exitPromise = new Promise((resolve) => {
        child.once("exit", (code, signal) => {
            exitState = { code, signal, premature: locked && !released };
            resolve(exitState);
        });
    });
    const lines = readline.createInterface({ input: child.stdout });
    try {
        await withTimeout(
        new Promise((resolve, reject) => {
            lines.once("line", (line) => {
                if (line === "LOCKED") {
                    locked = true;
                    resolve();
                } else {
                    reject(new Error(`PBIX lock failed: ${line}`));
                }
            });
            exitPromise.then((state) => {
                if (!locked) reject(new Error(`PBIX lock exited ${state.code}: ${stderr}`));
            });
        }),
        15000,
        "Timed out acquiring PBIX lock."
        );
    } catch (error) {
        released = true;
        child.stdin.destroy();
        lines.close();
        if (!exitState) child.kill();
        await withTimeout(exitPromise, 5000, "PBIX lock helper would not exit after acquire failure.")
            .catch(() => {});
        throw error;
    }
    function assertAlive() {
        if (exitState) {
            throw new Error(`PBIX lock helper exited prematurely: ${exitState.code}: ${stderr}`);
        }
    }
    async function verifyAlive() {
        assertAlive();
        child.stdin.write("PING\n");
        await withTimeout(new Promise((resolve, reject) => {
            lines.once("line", (line) => {
                if (line === "ALIVE") resolve();
                else reject(new Error(`Unexpected PBIX lock acknowledgment: ${line}`));
            });
            exitPromise.then((state) => {
                reject(new Error(`PBIX lock helper exited before acknowledgment: ${state.code}`));
            });
        }), 5000, "Timed out verifying PBIX lock liveness.");
        assertAlive();
    }
    return {
        processId: child.pid,
        assertAlive,
        verifyAlive,
        async release() {
            if (released) return exitState;
            released = true;
            if (!exitState) {
                child.stdin.write("RELEASE\n");
                child.stdin.end();
                try {
                    await withTimeout(exitPromise, 10000, "Timed out releasing PBIX lock.");
                } catch (error) {
                    child.kill();
                    await withTimeout(exitPromise, 5000, "PBIX lock would not exit.");
                    throw error;
                }
            }
            lines.close();
            return exitState;
        }
    };
}

module.exports = { acquirePbixPublicationLock };
