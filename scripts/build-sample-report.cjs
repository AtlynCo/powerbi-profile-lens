/**
 * Builds the offline PBIP sample.
 *
 * The sample is authored as source, not as a native .pbix: a PBIP project can be produced and
 * validated offline, while producing and reopening a genuine .pbix remains a manual Power BI
 * Desktop step. The semantic model is a DAX calculated table, so the project has no data source,
 * needs no credentials and needs no refresh. Every label is deliberately generic and carries no
 * business or demographic meaning.
 *
 * Usage: node scripts/build-sample-report.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const guid = manifest.visual.guid;
const sampleName = "AtlynProfileLensSample";
const sampleRoot = path.join(root, "samples", sampleName);
const reportRoot = path.join(sampleRoot, `${sampleName}.Report`);
const modelRoot = path.join(sampleRoot, `${sampleName}.SemanticModel`);
const table = "ProfileFacts";

const ENTITIES = ["Entity A", "Entity B", "Entity C"];
const PERIODS = ["Period 1", "Period 2"];
const BANDS = ["Band 1", "Band 2", "Band 3", "Band 4", "Band 5"];
const SERIES = ["Series X", "Series Y"];
const METRICS = ["Metric A", "Metric B", "Metric C"];

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value);
}

/** Deterministic pseudo values: the same repository state always produces the same sample. */
function syntheticValue(entityIndex, periodIndex, bandIndex, seriesIndex, metricIndex) {
    const seed = ((entityIndex + 1) * 31 + (periodIndex + 1) * 17 + (bandIndex + 1) * 7
        + (seriesIndex + 1) * 3 + (metricIndex + 1)) * 2654435761 % 1000;
    const shape = 100 - Math.abs(bandIndex - 2) * 18;
    return Math.round((shape * (1 + seed / 2000) + metricIndex * 5) * 10) / 10;
}

function buildRows() {
    const rows = [];
    ENTITIES.forEach((entity, entityIndex) => {
        PERIODS.forEach((period, periodIndex) => {
            BANDS.forEach((band, bandIndex) => {
                SERIES.forEach((series, seriesIndex) => {
                    const values = METRICS.map((unused, metricIndex) =>
                        syntheticValue(entityIndex, periodIndex, bandIndex, seriesIndex, metricIndex));
                    rows.push(
                        `        {"${entity}", "${period}", "${band}", ${bandIndex + 1}, "${series}", `
                        + `${values[0]}, ${values[1]}, ${values[2]}}`
                    );
                });
            });
        });
    });
    return rows;
}

function tableTmdl() {
    const rows = buildRows().join(",\n");
    return [
        "/// Offline synthetic sample data for the Atlyn Profile Lens listing. Defined as a DAX",
        "/// calculated table so the model has no data source, no credentials and no refresh.",
        "/// The labels are deliberately generic and carry no business or demographic meaning.",
        `table ${table}`,
        "",
        "\tcolumn Entity",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [Entity]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        "\tcolumn Period",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [Period]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        "\tcolumn Band",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [Band]",
        "\t\tsortByColumn: BandOrder",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        "\tcolumn BandOrder",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [BandOrder]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        "\tcolumn Series",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [Series]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        ...METRICS.flatMap((metric) => [
            "",
            `\tcolumn '${metric}'`,
            "\t\tsummarizeBy: sum",
            "\t\tisNameInferred",
            `\t\tsourceColumn: [${metric}]`,
            "",
            "\t\tannotation SummarizationSetBy = Automatic"
        ]),
        "",
        `\tpartition ${table} = calculated`,
        "\t\tmode: import",
        "\t\tsource =",
        "\t\t\t\tDATATABLE(",
        '\t\t\t\t    "Entity", STRING,',
        '\t\t\t\t    "Period", STRING,',
        '\t\t\t\t    "Band", STRING,',
        '\t\t\t\t    "BandOrder", INTEGER,',
        '\t\t\t\t    "Series", STRING,',
        ...METRICS.map((metric) => `\t\t\t\t    "${metric}", DOUBLE,`),
        "\t\t\t\t    {",
        ...rows.split("\n").map((row) => `\t\t\t\t        ${row.trim()}`),
        "\t\t\t\t    }",
        "\t\t\t\t)",
        ""
    ].join("\n");
}

function projection(property, aggregate) {
    if (!aggregate) {
        return {
            field: {
                Column: {
                    Expression: { SourceRef: { Entity: table } },
                    Property: property
                }
            },
            queryRef: `${table}.${property}`,
            nativeQueryRef: property
        };
    }
    return {
        field: {
            Aggregation: {
                Expression: {
                    Column: {
                        Expression: { SourceRef: { Entity: table } },
                        Property: property
                    }
                },
                Function: 0
            }
        },
        queryRef: `Sum(${table}.${property})`,
        nativeQueryRef: `Sum of ${property}`
    };
}

function visualJson(name, hierarchyProperties, withSeries, metrics) {
    const queryState = {
        Hierarchy: { projections: hierarchyProperties.map((property) => projection(property, false)) },
        Profiles: { projections: metrics.map((metric) => projection(metric, true)) }
    };
    if (withSeries) {
        queryState.Series = { projections: [projection("Series", false)] };
    }
    return {
        $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.7.0/schema.json",
        name,
        position: { x: 40, y: 40, z: 0, height: 800, width: 1520, tabOrder: 0 },
        visual: {
            visualType: guid,
            query: { queryState },
            objects: {
                data: [{ properties: { normalization: { expr: { Literal: { Value: "'shareOfProfile'" } } } } }],
                diagnostics: [{ properties: { showDiagnostics: { expr: { Literal: { Value: "true" } } } } }]
            },
            drillFilterOtherVisuals: true
        }
    };
}

const pages = [
    {
        name: "pageProfileOnly",
        displayName: "1 - Entity and band",
        visualName: "visualEntityBand",
        hierarchy: ["Entity", "Band"],
        series: false,
        metrics: ["Metric A"]
    },
    {
        name: "pagePeriodSeries",
        displayName: "2 - Entity, period, band with series",
        visualName: "visualPeriodSeries",
        hierarchy: ["Entity", "Period", "Band"],
        series: true,
        metrics: METRICS
    }
];

fs.rmSync(sampleRoot, { recursive: true, force: true });

writeJson(path.join(sampleRoot, `${sampleName}.pbip`), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
    version: "1.0",
    artifacts: [{ report: { path: `${sampleName}.Report` } }],
    settings: { enableAutoRecovery: true }
});

writeJson(path.join(reportRoot, ".platform"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
    metadata: { type: "Report", displayName: sampleName },
    config: { version: "2.0", logicalId: "3f2c74a1-5b6d-4a29-8c31-9e5b7a41d902" }
});

writeJson(path.join(reportRoot, "definition.pbir"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/1.0.0/schema.json",
    version: "4.0",
    datasetReference: { byPath: { path: `../${sampleName}.SemanticModel` } }
});

writeJson(path.join(reportRoot, "definition", "version.json"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
    version: "2.0.0"
});

writeJson(path.join(reportRoot, "definition", "report.json"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/2.1.0/schema.json",
    themeCollection: {
        baseTheme: { name: "CY24SU10", reportVersionAtImport: "5.55", type: "SharedResources" }
    },
    resourcePackages: [
        {
            name: guid,
            type: "CustomVisual",
            items: [
                {
                    name: `${guid}.pbiviz.json`,
                    path: `${guid}.pbiviz.json`,
                    type: "CustomVisualMetadata"
                }
            ]
        }
    ]
});

writeJson(path.join(reportRoot, "definition", "pages", "pages.json"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json",
    pageOrder: pages.map((page) => page.name),
    activePageName: pages[0].name
});

for (const page of pages) {
    writeJson(path.join(reportRoot, "definition", "pages", page.name, "page.json"), {
        $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json",
        name: page.name,
        displayName: page.displayName,
        displayOption: "FitToPage",
        height: 900,
        width: 1600
    });
    writeJson(
        path.join(reportRoot, "definition", "pages", page.name, "visuals", page.visualName, "visual.json"),
        visualJson(page.visualName, page.hierarchy, page.series, page.metrics)
    );
}

writeJson(path.join(modelRoot, ".platform"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
    metadata: { type: "SemanticModel", displayName: sampleName },
    config: { version: "2.0", logicalId: "8a71f5c2-4d3b-4e18-9f60-2c8d5b1a7e43" }
});

writeJson(path.join(modelRoot, "definition.pbism"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
    version: "4.2",
    settings: {}
});

writeText(path.join(modelRoot, "definition", "database.tmdl"), "database\n\tcompatibilityLevel: 1550\n");
writeText(
    path.join(modelRoot, "definition", "model.tmdl"),
    [
        "model Model",
        "\tculture: en-US",
        "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
        "\tsourceQueryCulture: en-US",
        "",
        `ref table ${table}`,
        ""
    ].join("\n")
);
writeText(path.join(modelRoot, "definition", "tables", `${table}.tmdl`), tableTmdl());

// Embed the exact packaged visual so the sample renders offline, and fail loudly when the package
// is missing rather than shipping a sample bound to nothing.
const packagePath = path.join(root, "dist", `${manifest.visual.name}.${manifest.visual.version}.pbiviz`);
const packageDescriptor = path.join(root, "dist", "package.json");

(async () => {
    if (!fs.existsSync(packagePath) || !fs.existsSync(packageDescriptor)) {
        console.warn(
            "dist package is missing, so the sample has no embedded visual. "
            + 'Run "npm run package" and then re-run this script.'
        );
        return;
    }
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(fs.readFileSync(packagePath));
    const resourceName = `resources/${guid}.pbiviz.json`;
    if (!zip.files[resourceName]) {
        throw new Error(`packaged resource ${resourceName} is missing from ${path.basename(packagePath)}`);
    }
    const target = path.join(reportRoot, "CustomVisuals", guid);
    fs.mkdirSync(path.join(target, "resources"), { recursive: true });
    fs.copyFileSync(packageDescriptor, path.join(target, "package.json"));
    fs.writeFileSync(
        path.join(target, "resources", `${guid}.pbiviz.json`),
        await zip.files[resourceName].async("nodebuffer")
    );
    console.log(`Embedded packaged visual ${guid} into the sample report.`);
})().then(() => {
    console.log(`Sample PBIP written to samples/${sampleName} (${buildRows().length} synthetic rows).`);
}).catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
});
