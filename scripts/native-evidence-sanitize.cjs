const fs = require("node:fs");

const FORBIDDEN_KEYS = /^(account|automationId|email|mainWindowTitle|processId|user|username|windowTitle)$/i;
const SENSITIVE_PATTERNS = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /\b(?:file|https?|ftp):[\s\S]*/gi,
    /\\\\[\s\S]*/g,
    /\/\/[^/][\s\S]*/g,
    /[a-z]:[\\/][\s\S]*/gi,
    /(?:\/Users\/|\/home\/)[\s\S]*/gi
];

function sanitizeString(value, usernames = []) {
    let sanitized = value;
    for (const pattern of SENSITIVE_PATTERNS) {
        sanitized = sanitized.replace(pattern, "[redacted]");
    }
    for (const username of usernames.filter(Boolean)) {
        sanitized = sanitized.replace(
            new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
            "[redacted]"
        );
    }
    return sanitized;
}

function sanitizeEvidence(value, usernames = []) {
    if (typeof value === "string") {
        return sanitizeString(value, usernames);
    }
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeEvidence(entry, usernames));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !FORBIDDEN_KEYS.test(key))
                .map(([key, entry]) => [key, sanitizeEvidence(entry, usernames)])
        );
    }
    return value;
}

function assertEvidenceSafe(value, usernames = []) {
    const serialized = JSON.stringify(value);
    if (/"(?:account|automationId|email|mainWindowTitle|processId|user|username|windowTitle)"\s*:/i
        .test(serialized)) {
        throw new Error("Forbidden evidence metadata remains.");
    }
    for (const pattern of SENSITIVE_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(serialized)) throw new Error("Sensitive evidence content remains.");
    }
    for (const username of usernames.filter(Boolean)) {
        if (serialized.toLowerCase().includes(username.toLowerCase())) {
            throw new Error("User-identifying evidence content remains.");
        }
    }
}

module.exports = {
    FORBIDDEN_KEYS,
    SENSITIVE_PATTERNS,
    assertEvidenceSafe,
    sanitizeEvidence,
    sanitizeString
};

if (require.main === module) {
    const usernames = [process.env.USERNAME, process.env.USER];
    if (process.argv[2] === "--check") {
        const value = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
        assertEvidenceSafe(value, usernames);
    } else {
        const input = fs.readFileSync(0, "utf8");
        const value = sanitizeEvidence(JSON.parse(input), usernames);
        assertEvidenceSafe(value, usernames);
        process.stdout.write(JSON.stringify(value));
    }
}
