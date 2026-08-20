/* eslint-disable powerbi-visuals/non-literal-fs-path */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const sample = path.join(root, "samples", "AtlynProfileLensSample");
const pagesRoot = path.join(
    sample,
    "AtlynProfileLensSample.Report",
    "definition",
    "pages"
);

function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

describe("offline PBIP validation sample", () => {
    it("contains the complete focused native validation page set", () => {
        const pages = readJson(path.join(pagesRoot, "pages.json")) as { pageOrder: string[] };
        expect(pages.pageOrder).toEqual([
            "pageHero",
            "pageProfileOnly",
            "pagePeriodSeries",
            "pageGeneratedLayouts",
            "pageBoundPoints",
            "pageBoundPolygons",
            "pageWorldPack",
            "pageStatePack",
            "pageCountyPack",
            "pageViewportLens",
            "pageSixProfiles",
            "pageNormalizations",
            "pageWorldDiagnostics",
            "pageAuthoring"
        ]);
    });

    it("covers every normalization and both interaction modes", () => {
        const generated = fs.readFileSync(
            path.join(root, "scripts", "build-sample-report.cjs"),
            "utf8"
        );
        for (const mode of [
            "raw",
            "shareOfProfile",
            "shareWithinSeries",
            "indexToMaximum",
            "alreadyPercent"
        ]) {
            expect(generated).toContain(`"${mode}"`);
        }
        expect(generated).toContain('interactionMode: "localOnly"');
        expect(generated).toContain('"reportSelection"');
        expect(generated).toContain('name: "pageViewportLens"');
        expect(generated).toContain('name: "pageHero"');
        expect(generated).toContain('homeView: "automatic"');
        expect(generated).toContain('contextLayout: "focusLens"');
        expect(generated).toContain('referenceDetail: "full"');
        expect(generated).toContain('labelDensity: "detailed"');
        expect(generated).toContain("showPhysicalLayers: true");
        expect(generated).toContain("showLabels: true");
        expect(generated).toContain("showGraticule: true");
        expect(generated).toContain("measureProfiles: true");
        expect(generated).toContain('fallbackEntityKey: "WLD"');
        expect(generated).toContain('interactionMode: "localOnly"');
        expect(generated).toContain('interactionMode: "reportSelection"');
        expect(generated).not.toContain("navigationEnabled: true");
        expect(generated).toContain(
            'Object.hasOwn(options, "navigationEnabled")'
        );
    });

    it("keeps exact-key and six-profile fixtures offline", () => {
        const model = fs.readFileSync(
            path.join(
                sample,
                "AtlynProfileLensSample.SemanticModel",
                "definition",
                "tables",
                "ProfileFacts.tmdl"
            ),
            "utf8"
        );
        for (const value of [
            "FRA", "NOR", "NE:KOS", "NE:SOL", '" USA "', '"fra"',
            "WLD", "DZA", "MLI", "NER", "TCD", "NGA", "CMR", "CAF", "COD"
        ]) {
            expect(model).toContain(value);
        }
        for (const metric of ["Metric A", "Metric B", "Metric C", "Metric D", "Metric E", "Metric F"]) {
            expect(model).toContain(metric);
        }
        for (const measure of [
            "Population Distribution",
            "Household Income Brackets",
            "Educational Attainment",
            "Community Health Indicators",
            "Labor Force Participation",
            "Housing & Infrastructure Index"
        ]) {
            expect(model).toContain(measure);
        }
        expect(model).toContain("mode: import");
        expect(model).not.toMatch(/\b(Web\.Contents|Sql\.Database|OData\.Feed|https?:\/\/)\b/);
    });
});
