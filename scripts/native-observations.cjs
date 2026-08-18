const crypto = require("node:crypto");
const fs = require("node:fs");

const SCENARIO_REQUIREMENTS = {
    fieldWells: ["field-hierarchy-first", "field-measure-first"],
    profilesAndNormalization: ["profiles-normalization-matrix"],
    contextModesAndJoins: ["context-provider-matrix"],
    selectionAndContextMenus: ["selection-context-menu-matrix"],
    tooltipsAndKeyboard: ["tooltip-keyboard-matrix"],
    lifecycleAndStaticSurfaces: ["lifecycle-static-matrix"],
    pbixOfflineReopen: ["pbix-offline-reopen"]
};
const OBSERVATION_DEFINITIONS = {
    "field-hierarchy-first": {
        scenario: "fieldWells", actionKind: "drag", logicalName: "hierarchy-field-well",
        controlType: "ListItem", predicateKind: "equals", expectedValue: "accepted",
        trustedInstrumentation: false
    },
    "field-measure-first": {
        scenario: "fieldWells", actionKind: "drag", logicalName: "profile-field-well",
        controlType: "ListItem", predicateKind: "equals", expectedValue: "accepted",
        trustedInstrumentation: false
    },
    "profiles-normalization-matrix": {
        scenario: "profilesAndNormalization", actionKind: "probe",
        logicalName: "profile-visual-surface", controlType: "Group",
        predicateKind: "equals", expectedValue: "complete", trustedInstrumentation: false
    },
    "context-provider-matrix": {
        scenario: "contextModesAndJoins", actionKind: "probe",
        logicalName: "context-visual-surface", controlType: "Group",
        predicateKind: "equals", expectedValue: "complete", trustedInstrumentation: false
    },
    "selection-context-menu-matrix": {
        scenario: "selectionAndContextMenus", actionKind: "probe",
        logicalName: "host-interaction-surface", controlType: "Group",
        predicateKind: "equals", expectedValue: "complete", trustedInstrumentation: false
    },
    "tooltip-keyboard-matrix": {
        scenario: "tooltipsAndKeyboard", actionKind: "probe",
        logicalName: "accessible-visual-surface", controlType: "Group",
        predicateKind: "equals", expectedValue: "complete", trustedInstrumentation: false
    },
    "lifecycle-static-matrix": {
        scenario: "lifecycleAndStaticSurfaces", actionKind: "probe",
        logicalName: "report-lifecycle-surface", controlType: "Group",
        predicateKind: "equals", expectedValue: "complete", trustedInstrumentation: false
    },
    "pbix-offline-reopen": {
        scenario: "pbixOfflineReopen", actionKind: "reopen-verify",
        logicalName: "owned-report", controlType: "Window", predicateKind: "unchanged",
        trustedInstrumentation: true
    }
};

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value).sort().map((key) => [key, stable(value[key])])
        );
    }
    return value;
}

function observationHash(observation) {
    const unsigned = { ...observation };
    delete unsigned.evidenceSha256;
    return crypto.createHash("sha256")
        .update(JSON.stringify(stable(unsigned)))
        .digest("hex");
}

function sealObservation(observation) {
    const persisted = structuredClone(observation);
    const control = persisted.action?.control;
    if (control && typeof control.automationId === "string") {
        control.identitySha256 = crypto.createHash("sha256")
            .update(`${control.logicalName}\0${control.controlType}\0${control.automationId}`)
            .digest("hex");
        delete control.automationId;
    }
    return { ...persisted, evidenceSha256: observationHash(persisted) };
}

function predicatePasses(observation) {
    switch (observation.expectedPredicate?.kind) {
    case "equals":
        return JSON.stringify(stable(observation.after?.value)) ===
            JSON.stringify(stable(observation.expectedPredicate.value));
    case "changed":
        return observation.before?.sha256 !== observation.after?.sha256;
    case "unchanged":
        return observation.before?.sha256 === observation.after?.sha256;
    case "truthy":
        return observation.after?.value === true;
    case "exists":
        return observation.after?.exists === true;
    default:
        return false;
    }
}

function validateObservation(observation, binding) {
    const problems = [];
    const definition = OBSERVATION_DEFINITIONS[observation?.id];
    if (!observation || typeof observation !== "object") problems.push("not an object");
    if (observation?.schemaVersion !== 1) problems.push("invalid schema version");
    if (!definition) problems.push("unknown observation id");
    if (definition?.trustedInstrumentation !== true) {
        problems.push("trusted instrumentation is unavailable");
    }
    if (definition && (observation.scenario !== definition.scenario ||
        observation.action?.kind !== definition.actionKind ||
        observation.action?.control?.logicalName !== definition.logicalName ||
        observation.action?.control?.controlType !== definition.controlType ||
        observation.expectedPredicate?.kind !== definition.predicateKind)) {
        problems.push("observation does not match its fixed definition");
    }
    if (definition?.predicateKind === "equals" &&
        (observation.expectedPredicate?.value !== definition.expectedValue ||
            observation.after?.value !== definition.expectedValue)) {
        problems.push("state does not match fixed expected value");
    }
    if (definition?.predicateKind === "unchanged" &&
        (!/^[0-9a-f]{64}$/.test(observation.before?.sha256 ?? "") ||
            !/^[0-9a-f]{64}$/.test(observation.after?.sha256 ?? ""))) {
        problems.push("state hashes are invalid");
    }
    if (!Number.isInteger(observation?.sequence) || observation.sequence < 1) {
        problems.push("invalid sequence");
    }
    if (!Number.isFinite(Date.parse(observation?.timestamp))) problems.push("invalid timestamp");
    if (observation?.sourceCommit !== binding.sourceCommit) problems.push("source mismatch");
    if (observation?.snapshotSha256 !== binding.snapshotSha256) problems.push("snapshot mismatch");
    if (!observation?.action?.kind || !observation?.action?.control?.logicalName ||
        !observation?.action?.control?.controlType ||
        !/^[0-9a-f]{64}$/.test(observation?.action?.control?.identitySha256 ?? "")) {
        problems.push("incomplete action identity");
    }
    if (!observation?.before || !observation?.after || !observation?.expectedPredicate) {
        problems.push("incomplete state predicate");
    }
    if (observation?.evidenceSha256 !== observationHash(observation)) {
        problems.push("evidence hash mismatch");
    }
    if (!predicatePasses(observation)) problems.push("expected predicate failed");
    return { valid: problems.length === 0, problems };
}

function deriveScenarioOutcomes(observations, binding) {
    const byId = new Map();
    let priorSequence = 0;
    let priorTimestamp = -Infinity;
    const globalProblems = [];
    for (const observation of observations ?? []) {
        if (observation.sequence !== priorSequence + 1) globalProblems.push("observation order");
        priorSequence = observation.sequence;
        const timestamp = Date.parse(observation.timestamp);
        if (timestamp <= priorTimestamp) globalProblems.push("timestamp order");
        priorTimestamp = timestamp;
        if (byId.has(observation.id)) globalProblems.push(`duplicate observation ${observation.id}`);
        byId.set(observation.id, observation);
    }
    return Object.fromEntries(Object.entries(SCENARIO_REQUIREMENTS).map(([scenario, required]) => {
        const missing = required.filter((id) => !byId.has(id));
        if (missing.length > 0) {
            return [scenario, {
                outcome: "unproven",
                required,
                missing,
                evidenceSha256: null
            }];
        }
        const validations = required.map((id) => ({
            id,
            ...validateObservation(byId.get(id), binding)
        }));
        const problems = [
            ...globalProblems,
            ...validations.flatMap((entry) => entry.problems.map((problem) => `${entry.id}: ${problem}`))
        ];
        return [scenario, {
            outcome: problems.length === 0 ? "passed" : "failed",
            required,
            problems,
            evidenceSha256: problems.length === 0
                ? crypto.createHash("sha256")
                    .update(required.map((id) => byId.get(id).evidenceSha256).join(""))
                    .digest("hex")
                : null
        }];
    }));
}

module.exports = {
    SCENARIO_REQUIREMENTS,
    OBSERVATION_DEFINITIONS,
    deriveScenarioOutcomes,
    observationHash,
    sealObservation,
    validateObservation
};

if (require.main === module) {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    if (process.argv[2] === "--seal") {
        process.stdout.write(JSON.stringify(sealObservation(input)));
    } else {
        process.stdout.write(JSON.stringify(
            deriveScenarioOutcomes(input.observations, input.binding)
        ));
    }
}
