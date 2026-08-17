/** Normalizes a path for manifests so the recorded value does not depend on the build platform. */
function portablePath(value) {
    return String(value).split("\\").join("/");
}

module.exports = { portablePath };
