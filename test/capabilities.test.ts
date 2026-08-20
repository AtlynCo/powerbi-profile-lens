import { describe, expect, it } from "vitest";
import type powerbi from "powerbi-visuals-api";
import { ProfileLensFormattingModel, resolveSettings } from "../src/formatting";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const capabilities = JSON.parse(
    readFileSync(resolve(__dirname, "..", "capabilities.json"), "utf8")
) as {
    privileges: unknown[];
    dataRoles: Array<{ name: string; kind: string; requiredTypes?: unknown[] }>;
    dataViewMappings: Array<{
        conditions?: Array<Record<string, { min?: number; max?: number }>>;
        matrix?: Record<string, unknown>;
    }>;
    objects: Record<string, { properties: Record<string, unknown> }>;
    supportsHighlight?: boolean;
    supportsKeyboardFocus?: boolean;
    supportsLandingPage?: boolean;
    supportsEmptyDataView?: boolean;
    supportsMultiVisualSelection?: boolean;
    supportsOnObjectFormatting?: boolean;
    tooltips?: { roles?: string[] };
    expandCollapse?: unknown;
    drilldown?: unknown;
};

const ROLE_CEILINGS: Record<string, number> = {
    Hierarchy: 3,
    Series: 1,
    Profiles: 6,
    ContextValue: 1,
    Latitude: 1,
    Longitude: 1,
    Geometry: 1,
    Tooltips: 10
};

function accepts(
    condition: Record<string, { min?: number; max?: number }>,
    assignment: Record<string, number>
): boolean {
    for (const [role, count] of Object.entries(assignment)) {
        const rule = condition[role];
        if (rule === undefined) {
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

function* assignments(): Generator<Record<string, number>> {
    const roles = Object.keys(ROLE_CEILINGS);
    const counters = roles.map(() => 0);
    for (;;) {
        const assignment: Record<string, number> = {};
        roles.forEach((role, index) => {
            assignment[role] = counters[index];
        });
        yield assignment;
        let position = roles.length - 1;
        while (position >= 0) {
            counters[position]++;
            if (counters[position] <= ROLE_CEILINGS[roles[position]]) {
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

describe("capabilities contract", () => {
    it("declares exactly one matrix data view mapping", () => {
        expect(capabilities.dataViewMappings).toHaveLength(1);
        expect(capabilities.dataViewMappings[0].matrix).toBeDefined();
    });

    it("never requires more than one role in a condition", () => {
        for (const condition of capabilities.dataViewMappings[0].conditions ?? []) {
            const required = Object.entries(condition)
                .filter(([, rule]) => typeof rule.min === "number" && (rule.min ?? 0) >= 1)
                .map(([role]) => role);
            expect(required, `condition requires ${required.join(", ")}`).toHaveLength(0);
        }
    });

    it("accepts every progressive field assignment", () => {
        const conditions = capabilities.dataViewMappings[0].conditions ?? [];
        const rejected: string[] = [];
        let checked = 0;
        for (const assignment of assignments()) {
            checked++;
            if (!conditions.some((condition) => accepts(condition, assignment))) {
                rejected.push(JSON.stringify(assignment));
            }
        }
        expect(checked).toBeGreaterThan(1000);
        expect(rejected).toEqual([]);
    });

    it("declares the documented role set with the documented ceilings", () => {
        const declared = capabilities.dataRoles.map((role) => role.name).sort();
        expect(declared).toEqual(Object.keys(ROLE_CEILINGS).sort());
        const condition = (capabilities.dataViewMappings[0].conditions ?? [])[0];
        for (const [role, ceiling] of Object.entries(ROLE_CEILINGS)) {
            expect(condition[role]?.max, `${role} max`).toBe(ceiling);
        }
    });

    it("requests no privileges and claims no on-object formatting", () => {
        expect(capabilities.privileges).toEqual([]);
        expect(capabilities.supportsOnObjectFormatting).toBeUndefined();
    });

    it("declares the host features the visual actually implements", () => {
        expect(capabilities.supportsHighlight).toBe(true);
        expect(capabilities.supportsKeyboardFocus).toBe(true);
        expect(capabilities.supportsLandingPage).toBe(true);
        expect(capabilities.supportsEmptyDataView).toBe(true);
        expect(capabilities.supportsMultiVisualSelection).toBe(true);
        expect(capabilities.tooltips?.roles).toEqual(["Tooltips"]);
        expect(capabilities.expandCollapse).toBeUndefined();
        expect(capabilities.drilldown).toBeUndefined();
    });

    it("exposes a formatting card for every object", () => {
        expect(Object.keys(capabilities.objects).sort()).toEqual([
            "accessibility",
            "context",
            "data",
            "diagnostics",
            "header",
            "interaction",
            "layout",
            "loading",
            "navigation",
            "period",
            "profiles",
            "series"
        ]);
    });

    it("does not advertise outward filter support", () => {
        expect(capabilities.objects.general).toBeUndefined();
        const interaction = capabilities.objects.interaction.properties.mode as {
            type: { enumeration: Array<{ value: string }> };
        };
        expect(interaction.type.enumeration.map((entry) => entry.value))
            .toEqual(["localOnly", "reportSelection"]);
        expect(Object.keys(capabilities.objects.navigation.properties).sort()).toEqual([
            "enabled",
            "fallbackEntityKey",
            "homeView",
            "maxZoom",
            "minZoom",
            "probeAnnouncementVerbosity",
            "showCenterProbe",
            "showGestureHelp",
            "showNoDataBackdrop",
            "showResetControl",
            "wheelSensitivity"
        ]);
        const navigation = capabilities.objects.navigation.properties.enabled as {
            type: { enumeration: Array<{ value: string }> };
        };
        expect(navigation.type.enumeration.map((entry) => entry.value))
            .toEqual(["auto", "on", "off"]);
        const homeView = capabilities.objects.navigation.properties.homeView as {
            type: { enumeration: Array<{ value: string }> };
        };
        expect(homeView.type.enumeration.map((entry) => entry.value))
            .toEqual(["automatic", "fit", "fill"]);
    });

    it("migrates absent and legacy boolean navigation values to auto/on/off", () => {
        const model = new ProfileLensFormattingModel();
        expect(resolveSettings(model).navigationMode).toBe("auto");
        expect(resolveSettings(model, {
            navigation: { enabled: true }
        } as unknown as powerbi.DataViewObjects).navigationMode).toBe("on");
        expect(resolveSettings(model, {
            navigation: { enabled: false }
        } as unknown as powerbi.DataViewObjects).navigationMode).toBe("off");
        expect(resolveSettings(model, {
            navigation: { enabled: "off" }
        } as unknown as powerbi.DataViewObjects).navigationMode).toBe("off");
        expect(resolveSettings(model).homeView).toBe("automatic");
        model.navigation.homeView.value = "fit";
        expect(resolveSettings(model).homeView).toBe("fit");
        model.navigation.homeView.value = "fill";
        expect(resolveSettings(model).homeView).toBe("fill");
        model.navigation.homeView.value = "unsupported";
        expect(resolveSettings(model).homeView).toBe("automatic");
    });
});
