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
const tablesRoot = path.join(
    sample,
    "AtlynProfileLensSample.SemanticModel",
    "definition",
    "tables"
);

const PLACEHOLDER_NAMES = [
    "Metric A", "Metric B", "Metric C", "Metric D", "Metric E", "Metric F",
    "Band 1", "Band 2", "Band 3", "Band 4", "Band 5",
    "Product A", "Team B", "Facility C", "Seat 04",
    "Unit E", "Unit F", "Unit G", "Unit H", "Unit I",
    "Series X", "Series Y", "Period 1", "Period 2"
];

const MALFORMED_KEYS = ['" USA "', '"fra"', '"XX"', '" 06037"'];

const MODEL_TABLES = [
    "CommunityProfiles",
    "WorldProfiles",
    "StateProfiles",
    "CountyProfiles",
    "KeyDiagnostics"
];

function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readTable(name: string): string {
    return fs.readFileSync(path.join(tablesRoot, `${name}.tmdl`), "utf8");
}

interface VisualDefinition {
    readonly visual: {
        readonly objects: {
            readonly context: Array<{
                properties: Record<string, { expr: { Literal: { Value: string } } }>;
            }>;
            readonly navigation: Array<{
                properties: Record<string, { expr: { Literal: { Value: string } } }>;
            }>;
        };
    };
}

function visualFiles(): Array<{ page: string; name: string; definition: VisualDefinition }> {
    const found: Array<{ page: string; name: string; definition: VisualDefinition }> = [];
    for (const page of fs.readdirSync(pagesRoot).sort()) {
        const visualsRoot = path.join(pagesRoot, page, "visuals");
        if (!fs.existsSync(visualsRoot)) {
            continue;
        }
        for (const name of fs.readdirSync(visualsRoot).sort()) {
            found.push({
                page,
                name,
                definition: readJson(
                    path.join(visualsRoot, name, "visual.json")
                ) as VisualDefinition
            });
        }
    }
    return found;
}

describe("offline PBIP validation sample", () => {
    it("contains the complete focused native validation page set", () => {
        const pages = readJson(path.join(pagesRoot, "pages.json")) as { pageOrder: string[] };
        expect(pages.pageOrder).toEqual([
            "pageHero",
            "pageProfileOnly",
            "pagePeriodSeries",
            "pageBoundPoints",
            "pageWorldPack",
            "pageStatePack",
            "pageCountyPack",
            "pageViewportLens",
            "pageSixProfiles",
            "pageNormalizations"
        ]);
    });

    it("covers every normalization and both interaction modes", () => {
        const generated = fs.readFileSync(
            path.join(root, "scripts", "sample-definition.cjs"),
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
        expect(generated).toContain('homeFocus: "automatic"');
        expect(generated).toContain('contextLayout: "focusLens"');
        expect(generated).toContain('referenceDetail: "full"');
        expect(generated).toContain('labelDensity: "detailed"');
        expect(generated).toContain("showPhysicalLayers: true");
        expect(generated).toContain("showLabels: true");
        expect(generated).toContain("showGraticule: true");
        expect(generated).toContain("measureProfiles: true");
        expect(generated).not.toContain("navigationEnabled: true");
        expect(
            fs.readFileSync(path.join(root, "scripts", "build-sample-report.cjs"), "utf8")
        ).toContain('Object.hasOwn(options, "navigationEnabled")');
    });

    it("configures an exact fallback Entity key on every context page", () => {
        const withContext = visualFiles().filter((entry) =>
            entry.definition.visual.objects.context[0].properties.mode.expr.Literal.Value
            !== "'none'");
        expect(withContext.length).toBeGreaterThanOrEqual(9);
        for (const entry of withContext) {
            const fallback = entry.definition.visual.objects.navigation[0]
                .properties.fallbackEntityKey;
            expect(
                fallback?.expr.Literal.Value ?? "",
                `${entry.page}/${entry.name} needs a fallback Entity key`
            ).toMatch(/^'.+'$/u);
        }
    });

    it("binds every packaged state and county", () => {
        const states = readTable("StateProfiles");
        for (const key of ["01", "02", "06", "11", "15", "48", "60", "66", "69", "72", "78"]) {
            expect(states).toContain(`{"${key}", `);
        }
        expect((states.match(/\{"\d{2}", /gu) ?? []).length).toBe(56 * 5);

        const counties = readTable("CountyProfiles");
        const countyRows = counties.match(/\{"\d{5}", /gu) ?? [];
        const countyKeys = new Set(countyRows.map((row) => row.slice(2, 7)));
        const countyPack = readJson(
            path.join(root, "src", "context", "packs", "generated", "us-counties-2025-5m.pack.json")
        ) as { topology: { objects: { features: { geometries: unknown[] } } } };
        expect(countyKeys.size).toBe(countyPack.topology.objects.features.geometries.length);
        expect(countyKeys.size).toBe(3235);
        for (const island of ["60", "66", "69", "72", "78"]) {
            expect(
                [...countyKeys].some((key) => key.startsWith(island)),
                `island area ${island} must be represented`
            ).toBe(true);
        }

        const world = readTable("WorldProfiles");
        for (const key of ["USA", "CAN", "MEX", "FRA", "NOR", "DZA", "NGA", "IND", "CHN"]) {
            expect(world).toContain(`{"${key}", `);
        }
        const worldKeys = new Set((world.match(/\{"[A-Z][A-Z:0-9]{2,7}", /gu) ?? [])
            .map((row) => row.slice(2, -3)));
        expect(worldKeys.size).toBeGreaterThanOrEqual(150);
    });

    it("declares the focused showcase as the World hero followed by complete counties", () => {
        const definition = require("../scripts/sample-definition.cjs") as {
            FOCUSED_PAGE_NAMES: string[];
        };
        expect(definition.FOCUSED_PAGE_NAMES).toEqual(["pageHero", "pageCountyPack"]);
        const generator = fs.readFileSync(
            path.join(root, "scripts", "build-focused-sample.cjs"),
            "utf8"
        );
        expect(generator).toContain("pages.activePageName = FOCUSED_PAGE_NAMES[0]");
        expect(generator).toContain("enableAutoRecovery: false");
        expect(generator).toContain("writeSampleIntegrity");
        expect(generator).toContain("verifySampleResourceParity");
    });

    it("keeps demo naming demographic and free of placeholders", () => {
        for (const table of MODEL_TABLES) {
            const model = readTable(table);
            for (const placeholder of PLACEHOLDER_NAMES) {
                expect(model, `${table} still uses ${placeholder}`).not.toContain(placeholder);
            }
            expect(model).toContain("mode: import");
            expect(model).not.toMatch(/\b(Web\.Contents|Sql\.Database|OData\.Feed|https?:\/\/)\b/);
        }
        const community = readTable("CommunityProfiles");
        for (const label of [
            "Residents",
            "Median household income",
            "Degree attainment rate",
            "Health coverage rate",
            "Labor force participation",
            "Housing cost burden",
            "0 to 17",
            "65 and over",
            "Urban",
            "Rural",
            "Riverbend District"
        ]) {
            expect(community).toContain(label);
        }
    });

    it("isolates malformed and duplicate keys on the diagnostics table only", () => {
        const diagnostics = readTable("KeyDiagnostics");
        for (const key of MALFORMED_KEYS) {
            expect(diagnostics).toContain(key);
        }
        for (const table of MODEL_TABLES.filter((name) => name !== "KeyDiagnostics")) {
            expect(readTable(table), `${table} must not carry malformed keys`).toBeDefined();
            for (const key of MALFORMED_KEYS) {
                expect(readTable(table), `${table} must not carry ${key}`).not.toContain(key);
            }
        }
    });
});
