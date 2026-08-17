/**
 * Field well contract guard.
 *
 * Microsoft documents that only one data role can have a minimum of >= 1 per condition
 * (https://learn.microsoft.com/en-us/power-bi/developer/visuals/dataview-mappings#conditions).
 * When that rule is violated, Power BI cannot find a satisfiable condition for a partially filled
 * field well, so every drop is rejected and the visual never receives data.
 *
 * This script also enumerates every reachable role count combination and proves that a condition
 * accepts it, which is what "progressive authoring" actually means in practice.
 *
 * Usage: node scripts/check-capabilities-conditions.mjs [...capabilities.json]
 */
import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

const ROLE_CEILING = {
    Hierarchy: 3,
    Series: 1,
    Profiles: 6,
    ContextValue: 1,
    Latitude: 1,
    Longitude: 1,
    Geometry: 1,
    Tooltips: 10
};

const files = argv.slice(2);
if (files.length === 0) {
    console.error("usage: node check-capabilities-conditions.mjs <capabilities.json...>");
    exit(2);
}

let failures = 0;

function fail(message) {
    console.error(`\u2717 ${message}`);
    failures++;
}

function accepts(condition, assignment) {
    for (const [role, count] of Object.entries(assignment)) {
        const rule = condition[role];
        if (rule === undefined) {
            // A role omitted from the condition is unconstrained only when it is unbound.
            if (count > 0) {
                return false;
            }
            continue;
        }
        if (typeof rule.min === "number" && count < rule.min) {
            return false;
        }
        if (typeof rule.max === "number" && count > rule.max) {
            return false;
        }
    }
    return true;
}

function* enumerateAssignments(roles) {
    const names = roles.map((role) => role.name);
    const ceilings = names.map((name) => ROLE_CEILING[name] ?? 1);
    const counters = names.map(() => 0);
    for (;;) {
        const assignment = {};
        names.forEach((name, index) => {
            assignment[name] = counters[index];
        });
        yield assignment;
        let position = names.length - 1;
        while (position >= 0) {
            counters[position]++;
            if (counters[position] <= ceilings[position]) {
                break;
            }
            counters[position] = 0;
            position--;
        }
        if (position < 0) {
            return;
        }
    }
}

for (const file of files) {
    const before = failures;
    let capabilities;
    try {
        capabilities = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
        fail(`${file}: unreadable (${error.message})`);
        continue;
    }

    const roles = capabilities.dataRoles ?? [];
    const declaredRoles = new Set(roles.map((role) => role.name));
    const mappings = capabilities.dataViewMappings ?? [];

    if (mappings.length !== 1) {
        fail(`${file}: expected exactly one dataViewMapping, found ${mappings.length}.`);
    }
    if (mappings[0] && !mappings[0].matrix) {
        fail(`${file}: the single mapping must be a matrix mapping.`);
    }
    if (!Array.isArray(capabilities.privileges) || capabilities.privileges.length !== 0) {
        fail(`${file}: privileges must be declared and empty.`);
    }

    mappings.forEach((mapping, mappingIndex) => {
        const conditions = mapping.conditions ?? [];
        if (conditions.length === 0) {
            fail(`${file} [mapping ${mappingIndex}]: no conditions declared.`);
        }
        conditions.forEach((condition, conditionIndex) => {
            const where = `${file} [mapping ${mappingIndex}, condition ${conditionIndex}]`;
            const required = Object.entries(condition)
                .filter(([, rule]) => typeof rule?.min === "number" && rule.min >= 1)
                .map(([role]) => role);
            if (required.length > 1) {
                fail(
                    `${where}: ${required.length} roles declare min >= 1 (${required.join(", ")}). ` +
                    "Power BI allows at most one, so the field wells would reject every drop."
                );
            }
            for (const role of Object.keys(condition)) {
                if (!declaredRoles.has(role)) {
                    fail(`${where}: condition references undeclared role "${role}".`);
                }
            }
            for (const [role, rule] of Object.entries(condition)) {
                if (typeof rule?.min === "number" && typeof rule?.max === "number" && rule.min > rule.max) {
                    fail(`${where}: role "${role}" has min ${rule.min} > max ${rule.max}.`);
                }
                const ceiling = ROLE_CEILING[role];
                if (ceiling !== undefined && typeof rule?.max === "number" && rule.max > ceiling) {
                    fail(`${where}: role "${role}" max ${rule.max} exceeds the documented ceiling ${ceiling}.`);
                }
            }
        });
    });

    for (const role of roles) {
        if (ROLE_CEILING[role.name] === undefined) {
            fail(`${file}: role "${role.name}" has no documented ceiling in this guard.`);
        }
    }

    const conditions = mappings.flatMap((mapping) => mapping.conditions ?? []);
    let checked = 0;
    let rejected = 0;
    for (const assignment of enumerateAssignments(roles)) {
        checked++;
        if (!conditions.some((condition) => accepts(condition, assignment))) {
            rejected++;
            if (rejected <= 5) {
                const description = Object.entries(assignment)
                    .filter(([, count]) => count > 0)
                    .map(([role, count]) => `${role}=${count}`)
                    .join(", ") || "no fields";
                fail(`${file}: no condition accepts the progressive assignment ${description}.`);
            }
        }
    }
    if (rejected > 5) {
        fail(`${file}: ${rejected} progressive assignments were rejected in total.`);
    }

    if (failures === before) {
        console.log(`\u2713 ${file} (${checked} progressive assignments accepted)`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} violation(s) found.`);
    exit(1);
}
console.log("\nCapabilities conditions are valid.");
