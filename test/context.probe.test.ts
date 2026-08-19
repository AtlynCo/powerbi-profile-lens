import { describe, expect, it } from "vitest";
import type {
    ContextEntityBinding,
    ContextFeature
} from "../src/context/contract";
import { scene } from "../src/context/providers/common";
import {
    buildProfileDetailCoverage,
    resolveFallbackEntity,
    resolveFeatureFocus
} from "../src/context/viewport/focus";
import { parseMatrix } from "../src/model/parseMatrix";
import { buildMatrixDataView } from "./helpers/mockDataView";

function feature(index: number, key: string): ContextFeature {
    return {
        index,
        key,
        label: `Feature ${key}`,
        description: `Feature ${key}`,
        geometry: {
            kind: "grid",
            center: { x: index + 0.5, y: 0.5 },
            polygons: [[[
                { x: index, y: 0 },
                { x: index + 1, y: 0 },
                { x: index + 1, y: 1 },
                { x: index, y: 1 },
                { x: index, y: 0 }
            ]]]
        }
    };
}

function binding(
    featureKey: string,
    entityIndex: number,
    entityKey: string,
    entityLabel: string
): ContextEntityBinding {
    return {
        featureKey,
        entityIndex,
        entityKey,
        entityLabel,
        selection: { key: entityKey, hostIdentity: { entityIndex } },
        contextValue: null,
        tooltipValues: []
    };
}

describe("probe-driven Context focus", () => {
    it("distinguishes loaded, unbound, unloaded, and no-feature states", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["USA", "CAN"],
            periods: ["2025"],
            bands: ["Band 1"],
            profiles: ["Metric A"]
        }));
        const usa = model.entities[0];
        const can = model.entities[1];
        const context = scene(
            "test",
            "grid",
            [feature(0, "USA"), feature(1, "MEX"), feature(2, "CAN")],
            [
                binding("USA", usa.index, usa.key, usa.label),
                binding("CAN", can.index, can.key, can.label)
            ]
        );
        const loadedCoverage = buildProfileDetailCoverage(model);
        expect(resolveFeatureFocus(
            context,
            model,
            loadedCoverage,
            "USA",
            null,
            { kind: "disabled" },
            "probe",
            1
        )).toMatchObject({
            kind: "loadedEntity",
            featureKey: "USA",
            entityKey: usa.key
        });
        expect(resolveFeatureFocus(
            context,
            model,
            loadedCoverage,
            "MEX",
            null,
            { kind: "disabled" },
            "probe",
            1
        )).toMatchObject({ kind: "unboundFeature", featureKey: "MEX" });

        const unloadedModel = {
            ...model,
            cells: model.cells.filter((cell) => cell.entityIndex !== can.index)
        };
        expect(resolveFeatureFocus(
            context,
            unloadedModel,
            buildProfileDetailCoverage(unloadedModel),
            "CAN",
            null,
            { kind: "disabled" },
            "probe",
            2
        )).toMatchObject({
            kind: "unloadedEntity",
            featureKey: "CAN",
            entityKey: can.key
        });
        expect(resolveFeatureFocus(
            context,
            model,
            loadedCoverage,
            null,
            null,
            { kind: "disabled" },
            "probe",
            1
        )).toMatchObject({ kind: "noFeature", featureKey: null });
    });

    it("uses exact loaded fallback only for no-feature", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["USA", "WLD"],
            bands: ["Band 1"],
            profiles: ["Metric A"]
        }));
        const coverage = buildProfileDetailCoverage(model);
        const usa = model.entities[0];
        const context = scene(
            "test",
            "grid",
            [feature(0, "USA"), feature(1, "MEX")],
            [binding("USA", usa.index, usa.key, usa.label)]
        );
        const fallback = resolveFallbackEntity(model, coverage, "WLD");
        expect(fallback.kind).toBe("valid");
        expect(resolveFeatureFocus(
            context,
            model,
            coverage,
            null,
            null,
            fallback,
            "probe",
            1
        )).toMatchObject({
            kind: "fallbackEntity",
            entityLabel: "WLD",
            featureKey: null
        });
        expect(resolveFeatureFocus(
            context,
            model,
            coverage,
            "MEX",
            null,
            fallback,
            "probe",
            1
        )).toMatchObject({ kind: "unboundFeature", featureKey: "MEX" });
        expect(resolveFallbackEntity(model, coverage, "wld")).toMatchObject({
            kind: "invalid",
            reason: "notFound"
        });
        expect(resolveFallbackEntity(model, coverage, " WLD ")).toMatchObject({
            kind: "invalid",
            reason: "notFound"
        });
    });

    it("preserves an exact loaded period and falls forward to the first loaded period", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["USA", "CAN"],
            periods: ["2025", "2026"],
            bands: ["Band 1"],
            profiles: ["Metric A"]
        }));
        const can = model.entities[1];
        const periods = model.periodsByEntity.get(can.index) ?? [];
        const only2026 = {
            ...model,
            cells: model.cells.filter((cell) =>
                cell.entityIndex !== can.index || cell.periodIndex === 1)
        };
        const context = scene(
            "test",
            "grid",
            [feature(0, "CAN")],
            [binding("CAN", can.index, can.key, can.label)]
        );
        const coverage = buildProfileDetailCoverage(only2026);
        expect(resolveFeatureFocus(
            context,
            only2026,
            coverage,
            "CAN",
            periods[0]?.key ?? null,
            { kind: "disabled" },
            "probe",
            1
        )).toMatchObject({
            kind: "loadedEntity",
            periodIndex: 1,
            periodKey: periods[1]?.key
        });
        expect(resolveFeatureFocus(
            context,
            only2026,
            coverage,
            "CAN",
            periods[1]?.key ?? null,
            { kind: "disabled" },
            "probe",
            1
        )).toMatchObject({
            kind: "loadedEntity",
            periodIndex: 1,
            periodKey: periods[1]?.key
        });
    });

    it("refreshes the render token for new resident detail without changing the hit", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["USA"],
            bands: ["Band 1"],
            profiles: ["Metric A"]
        }));
        const entity = model.entities[0];
        const context = scene(
            "test",
            "grid",
            [feature(0, "USA")],
            [binding("USA", entity.index, entity.key, entity.label)]
        );
        const first = resolveFeatureFocus(
            context,
            model,
            buildProfileDetailCoverage(model),
            "USA",
            null,
            { kind: "disabled" },
            "probe",
            1
        );
        const second = resolveFeatureFocus(
            context,
            model,
            buildProfileDetailCoverage(model),
            "USA",
            null,
            { kind: "disabled" },
            "probe",
            2
        );
        expect(second.featureKey).toBe(first.featureKey);
        expect(second.announcementToken).toBe(first.announcementToken);
        expect(second.renderToken).not.toBe(first.renderToken);
    });
});
