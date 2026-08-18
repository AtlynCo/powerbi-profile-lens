import { describe, expect, it } from "vitest";
import type powerbi from "powerbi-visuals-api";
import { IMPLICIT_INDEX, LIMITS, cellKey, tooltipKey } from "../src/model/contract";
import { DEFAULT_PARSE_OPTIONS, parseMatrix } from "../src/model/parseMatrix";
import { buildEmptyDataView, buildMatrixDataView } from "./helpers/mockDataView";

const bands = ["Band 1", "Band 2", "Band 3"];

describe("matrix parsing", () => {
    it("reports the empty stage when nothing is bound", () => {
        const model = parseMatrix(buildEmptyDataView());
        expect(model.stage).toBe("empty");
        expect(model.diagnostics.map((entry) => entry.code)).toContain("needsEntity");
        expect(model.entities).toHaveLength(0);
    });

    it("asks for a band field when only the entity level is bound", () => {
        const dataView = buildMatrixDataView({ entities: ["Entity A"], bands, profiles: ["Metric A"] });
        dataView.matrix!.rows!.levels = [dataView.matrix!.rows!.levels[0]];
        const model = parseMatrix(dataView);
        expect(model.stage).toBe("needsBand");
        expect(model.diagnostics.map((entry) => entry.code)).toContain("needsBand");
    });

    it("asks for a profile measure when the hierarchy is complete but no measure is bound", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: []
        }));
        expect(model.stage).toBe("needsProfile");
        expect(model.diagnostics.map((entry) => entry.code)).toContain("needsProfile");
    });

    it("parses Entity > Band with a single profile and no series", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands,
            profiles: ["Metric A"]
        }));
        expect(model.stage).toBe("ready");
        expect(model.hierarchy.hasPeriodLevel).toBe(false);
        expect(model.entities.map((entity) => entity.label)).toEqual(["Entity A", "Entity B"]);
        expect(model.bands.map((band) => band.label)).toEqual(bands);
        expect(model.series).toHaveLength(0);
        expect(model.cells).toHaveLength(2 * bands.length);
        const first = model.cellIndex.get(cellKey({
            entityIndex: 0,
            periodIndex: IMPLICIT_INDEX,
            bandIndex: 0,
            seriesIndex: IMPLICIT_INDEX,
            profileIndex: 0
        }));
        expect(first?.value).toBe(10);
    });

    it("parses Entity > Period > Band with two series and six profiles", () => {
        const profiles = ["A", "B", "C", "D", "E", "F"];
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            periods: ["Period 1", "Period 2"],
            bands,
            series: ["Series X", "Series Y"],
            profiles
        }));
        expect(model.hierarchy.hasPeriodLevel).toBe(true);
        expect(model.periodsByEntity.get(0)?.map((period) => period.label))
            .toEqual(["Period 1", "Period 2"]);
        expect(model.series.map((series) => series.label)).toEqual(["Series X", "Series Y"]);
        expect(model.profiles).toHaveLength(6);
        expect(model.cells).toHaveLength(2 * bands.length * 2 * profiles.length);
    });

    it("does not reuse the first series value when a later series intersection is absent", () => {
        const view = buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            series: ["Series X", "Series Y"],
            profiles: ["Metric A"]
        });
        const bandNode = view.matrix?.rows?.root?.children?.[0]?.children?.[0];
        delete (bandNode?.values as Record<number, powerbi.DataViewMatrixNodeValue>)[1];

        const model = parseMatrix(view);
        expect(model.cells[0].value).toBe(11);
        expect(model.cells[1].value).toBeNull();
        expect(model.cells[1].state).toBe("missing");
    });

    it("preserves host band order rather than sorting labels", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["100+", "20-24", "5-9"],
            profiles: ["Metric A"]
        }));
        expect(model.bands.map((band) => band.label)).toEqual(["100+", "20-24", "5-9"]);
    });

    it("caps profiles at six and reports the received and retained counts", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["A", "B", "C", "D", "E", "F", "G"]
        }));
        expect(model.profiles).toHaveLength(LIMITS.maxProfiles);
        const diagnostic = model.diagnostics.find((entry) => entry.code === "profilesOverLimit");
        expect(diagnostic).toMatchObject({ received: 7, retained: 6, rejected: 1 });
    });

    it("caps series at two and reports the unsupported series", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            series: ["X", "Y", "Z"],
            profiles: ["Metric A"]
        }));
        expect(model.series).toHaveLength(2);
        const diagnostic = model.diagnostics.find((entry) => entry.code === "seriesOverLimit");
        expect(diagnostic).toMatchObject({ received: 3, retained: 2, rejected: 1 });
    });

    it("rejects duplicate cells instead of overwriting them", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A"],
            duplicateFirstBand: true
        }));
        const diagnostic = model.diagnostics.find((entry) => entry.code === "duplicateCells");
        expect(diagnostic?.rejected).toBe(1);
        expect(model.counts.duplicate).toBe(1);
    });

    it("classifies blank, non numeric and non finite values separately", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A"],
            value: ({ bandIndex }) => {
                if (bandIndex === 0) {
                    return null;
                }
                if (bandIndex === 1) {
                    return "not a number";
                }
                return Number.POSITIVE_INFINITY;
            }
        }));
        expect(model.counts.missing).toBe(1);
        expect(model.counts.nonNumeric).toBe(1);
        expect(model.counts.nonFinite).toBe(1);
        expect(model.cells[2].value).toBe(Number.POSITIVE_INFINITY);
        expect(model.cells[2].state).toBe("nonFinite");
        const codes = model.diagnostics.map((entry) => entry.code);
        expect(codes).toContain("blankValues");
        expect(codes).toContain("nonNumericValues");
        expect(codes).toContain("nonFiniteValues");
    });

    it("keeps numeric strings that are genuinely numeric", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            value: () => "42.5"
        }));
        expect(model.cells[0].value).toBe(42.5);
        expect(model.cells[0].state).toBe("value");
    });

    it("captures highlights", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A"],
            highlight: ({ bandIndex }) => (bandIndex === 0 ? 10 : null)
        }));
        expect(model.hasAnyHighlight).toBe(true);
        expect(model.cells[0].highlight).toBe(10);
        expect(model.cells[1].highlight).toBeNull();
        expect(model.diagnostics.map((entry) => entry.code)).toContain("highlightActive");
    });

    it("collects bound tooltip fields per band and series", () => {
        const model = parseMatrix(
            buildMatrixDataView({
                entities: ["Entity A"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                tooltips: [{ name: "Note", value: "context" }]
            }),
            { ...DEFAULT_PARSE_OPTIONS, formatValue: (value) => String(value) }
        );
        expect(model.tooltipFields.map((field) => field.label)).toEqual(["Note"]);
        const data = model.tooltipIndex.get(tooltipKey(0, IMPLICIT_INDEX, 0, IMPLICIT_INDEX));
        expect(data).toEqual([{ fieldIndex: 0, label: "Note", value: "context" }]);
    });

    it("builds selection identities for band nodes when the host provides a builder", () => {
        const model = parseMatrix(
            buildMatrixDataView({ entities: ["Entity A"], bands, profiles: ["Metric A"] }),
            DEFAULT_PARSE_OPTIONS,
            { createSelectionId: (node) => (node.identity as unknown as { key: string }).key }
        );
        expect(model.entities[0].identity).toBe("entity:0");
        expect(model.bandIdentities.get(`0|${IMPLICIT_INDEX}|0`)).toBe("band:0:-1:0");
    });

    it("produces a stable fingerprint for the same query shape", () => {
        const first = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A"]
        }));
        const second = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A"]
        }));
        const different = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A", "Metric B"]
        }));
        expect(first.fingerprint).toBe(second.fingerprint);
        expect(first.fingerprint).not.toBe(different.fingerprint);
    });
});

describe("future map roles", () => {
    it("validates entity level context values and coordinates without rendering geography", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands,
            profiles: ["Metric A"],
            contextValue: (entityIndex) => 100 + entityIndex,
            latitude: (entityIndex) => 40 + entityIndex,
            longitude: (entityIndex) => -70 - entityIndex
        }));
        expect(model.extension.boundRoles).toEqual(["ContextValue", "Latitude", "Longitude"]);
        expect(model.extension.contextValues).toEqual([
            { entityIndex: 0, value: 100, formatString: null, origin: "entityNode" },
            { entityIndex: 1, value: 101, formatString: null, origin: "entityNode" }
        ]);
        expect(model.extension.coordinates).toEqual([
            { entityIndex: 0, latitude: 40, longitude: -70, origin: "entityNode" },
            { entityIndex: 1, latitude: 41, longitude: -71, origin: "entityNode" }
        ]);
        const diagnostic = model.diagnostics.find((entry) => entry.code === "extensionRolesProfileOnly");
        expect(diagnostic?.detail).toBe("ContextValue, Latitude, Longitude");
        expect(diagnostic?.severity).toBe("warning");
    });

    it("rejects out of range coordinates and reports the count", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A"],
            latitude: () => 120,
            longitude: () => -70
        }));
        expect(model.extension.coordinates).toEqual([]);
        expect(model.extension.rejected.invalidCoordinates).toBe(1);
        expect(model.extension.rejected.incompleteCoordinates).toBe(1);
        expect(model.diagnostics.map((entry) => entry.code)).toContain("invalidCoordinates");
    });

    it("rejects conflicting coordinates for the same entity", () => {
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A"],
            extensionOnLeaves: true,
            latitude: () => 40,
            longitude: () => -70
        }));
        expect(model.extension.coordinates).toHaveLength(1);

        const conflicting = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A"],
            extensionOnLeaves: true,
            latitude: () => 40,
            longitude: () => -70
        }));
        expect(conflicting.extension.rejected.conflictingCoordinates).toBe(0);
    });

    it("measures and classifies geometry text without parsing it", () => {
        const geoJson = '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}';
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A"],
            geometry: () => geoJson
        }));
        expect(model.extension.geometry).toEqual([{
            entityIndex: 0,
            text: geoJson,
            characters: geoJson.length,
            formatHint: "geoJsonCandidate",
            withinCharacterLimit: true,
            origin: "entityNode"
        }]);
        expect(model.diagnostics.map((entry) => entry.code)).toContain("extensionRolesProfileOnly");
    });

    it("flags geometry beyond the documented character limit", () => {
        const oversized = `POLYGON((${"0 0,".repeat(9000)}0 0))`;
        const model = parseMatrix(buildMatrixDataView({
            entities: ["Entity A"],
            bands,
            profiles: ["Metric A"],
            geometry: () => oversized
        }));
        expect(model.extension.geometry[0].withinCharacterLimit).toBe(false);
        expect(model.extension.geometry[0].formatHint).toBe("wktCandidate");
        expect(model.diagnostics.map((entry) => entry.code)).toContain("oversizedGeometry");
    });
});
