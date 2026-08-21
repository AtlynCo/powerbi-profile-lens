/**
 * Builds the offline PBIP sample.
 *
 * The sample is authored as source, not as a native .pbix: a PBIP project can be produced and
 * validated offline, while producing and reopening a genuine .pbix remains a manual Power BI
 * Desktop step. Every semantic model table is a DAX calculated table, so the project has no data
 * source, needs no credentials and needs no refresh.
 *
 * The model and the page configuration live in scripts/sample-definition.cjs, which has no side
 * effects, so the packaged-Chromium demo-page audit mounts exactly the configuration authored here.
 *
 * Usage: node scripts/build-sample-report.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { writeSampleIntegrity } = require("./sample-integrity.cjs");
const { verifySampleResourceParity } = require("./sample-resource-parity.cjs");
const definition = require("./sample-definition.cjs");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const guid = manifest.visual.guid;
const sampleName = "AtlynProfileLensSample";
const sampleRoot = path.join(root, "samples", sampleName);
const reportRoot = path.join(sampleRoot, `${sampleName}.Report`);
const modelRoot = path.join(sampleRoot, `${sampleName}.SemanticModel`);

const { AGE_BANDS, MEASURES, TABLES, pages, tableRows } = definition;
const TABLE_IDS = ["community", "world", "state", "county", "diagnostics"];

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value);
}

function dax(text) {
    return String(text).replaceAll('"', '""');
}

function column(name, summarize, sortBy) {
    const lines = [
        "",
        name.includes(" ") ? `\tcolumn '${name}'` : `\tcolumn ${name}`,
        `\t\tsummarizeBy: ${summarize}`,
        "\t\tisNameInferred",
        `\t\tsourceColumn: [${name}]`
    ];
    if (sortBy) {
        lines.push(`\t\tsortByColumn: ${sortBy}`);
    }
    lines.push("", "\t\tannotation SummarizationSetBy = Automatic");
    return lines;
}

/** Ordered column descriptors for one table, matching the DATATABLE literal exactly. */
function tableColumns(tableId) {
    const table = TABLES[tableId];
    const columns = [{ name: table.keyColumn, summarize: "none" }];
    if (table.labelColumn) {
        columns.push({ name: table.labelColumn, summarize: "none" });
    }
    if (table.periods.length > 0) {
        columns.push({ name: "Period", summarize: "none" });
    }
    columns.push({ name: "AgeBand", summarize: "none", sortBy: "AgeOrder" });
    columns.push({ name: "AgeOrder", summarize: "none" });
    if (table.series.length > 0) {
        columns.push({ name: "Settlement", summarize: "none" });
    }
    for (const measure of table.measures) {
        columns.push({ name: measure, summarize: "sum", type: "DOUBLE" });
    }
    if (table.coordinates) {
        columns.push({ name: "Latitude", summarize: "none", type: "DOUBLE" });
        columns.push({ name: "Longitude", summarize: "none", type: "DOUBLE" });
        columns.push({ name: "Geometry", summarize: "none" });
    }
    return columns;
}

function rowLiteral(tableId, row) {
    const table = TABLES[tableId];
    const cells = [`"${dax(row.key)}"`];
    if (table.labelColumn) {
        cells.push(`"${dax(row.label)}"`);
    }
    if (table.periods.length > 0) {
        cells.push(`"${dax(row.period)}"`);
    }
    cells.push(`"${dax(row.band)}"`, String(row.bandOrder));
    if (table.series.length > 0) {
        cells.push(`"${dax(row.settlement)}"`);
    }
    for (const value of row.values) {
        cells.push(String(value));
    }
    if (table.coordinates) {
        cells.push(
            String(definition.LATITUDES[row.entryIndex]),
            String(definition.LONGITUDES[row.entryIndex]),
            `"${dax(definition.GEOMETRIES[row.entryIndex])}"`
        );
    }
    return `{${cells.join(", ")}}`;
}

function tableTmdl(tableId) {
    const table = TABLES[tableId];
    const columns = tableColumns(tableId);
    const rows = tableRows(tableId);
    const measures = MEASURES[tableId].flatMap((measure) => [
        `\tmeasure '${measure.name}' = ${measure.expression}(${table.name}[${measure.column}])`,
        ""
    ]);
    const contextMeasures = [
        `\tmeasure 'Context value' = SUM(${table.name}[${table.measures[0]}])`,
        ""
    ];
    const coordinateMeasures = table.coordinates
        ? [
            `\tmeasure 'Selected latitude' = SELECTEDVALUE(${table.name}[Latitude])`,
            "",
            `\tmeasure 'Selected longitude' = SELECTEDVALUE(${table.name}[Longitude])`,
            "",
            `\tmeasure 'Selected geometry' = SELECTEDVALUE(${table.name}[Geometry])`,
            ""
        ]
        : [];
    return [
        `/// Offline synthetic sample data for Atlyn Profile Lens: ${tableId} demographic profiles.`,
        "/// Defined as a DAX calculated table so the model has no data source, no credentials and",
        "/// no refresh. Every value is generated by a deterministic function of the key and carries",
        "/// no observation from any real statistical source.",
        "/// Indicators are reported across five age bands: "
            + `${AGE_BANDS.join(", ")}.`,
        `table ${table.name}`,
        ...columns.flatMap((entry) => column(entry.name, entry.summarize, entry.sortBy)),
        "",
        ...contextMeasures,
        ...measures,
        ...coordinateMeasures,
        `\tpartition ${table.name} = calculated`,
        "\t\tmode: import",
        "\t\tsource =",
        "\t\t\t\tDATATABLE(",
        ...columns.map((entry) =>
            `\t\t\t\t    "${entry.name}", ${entry.type ?? (entry.name === "AgeOrder" ? "INTEGER" : "STRING")},`),
        "\t\t\t\t    {",
        ...rows.map((row, index) =>
            `\t\t\t\t        ${rowLiteral(tableId, row)}${index === rows.length - 1 ? "" : ","}`),
        "\t\t\t\t    }",
        "\t\t\t\t)",
        ""
    ].join("\n");
}

function projection(tableName, property, aggregate) {
    if (!aggregate) {
        return {
            field: {
                Column: {
                    Expression: { SourceRef: { Entity: tableName } },
                    Property: property
                }
            },
            queryRef: `${tableName}.${property}`,
            nativeQueryRef: property
        };
    }
    return {
        field: {
            Aggregation: {
                Expression: {
                    Column: {
                        Expression: { SourceRef: { Entity: tableName } },
                        Property: property
                    }
                },
                Function: 0
            }
        },
        queryRef: `Sum(${tableName}.${property})`,
        nativeQueryRef: `Sum of ${property}`
    };
}

function measureProjection(tableName, property) {
    return {
        field: {
            Measure: {
                Expression: { SourceRef: { Entity: tableName } },
                Property: property
            }
        },
        queryRef: `${tableName}.${property}`,
        nativeQueryRef: property
    };
}

function visualJson(visual) {
    const tableName = TABLES[visual.table].name;
    const options = visual.options ?? {};
    const queryState = {
        Hierarchy: {
            projections: visual.hierarchy.map((property) =>
                projection(tableName, property, false))
        },
        Profiles: {
            projections: visual.metrics.map((metric) =>
                (options.measureProfiles
                    ? measureProjection(tableName, metric)
                    : projection(tableName, metric, true)))
        }
    };
    if (visual.series) {
        queryState.Series = { projections: [projection(tableName, "Settlement", false)] };
    }
    if (options.contextValue) {
        queryState.ContextValue = { projections: [measureProjection(tableName, "Context value")] };
    }
    if (options.coordinates) {
        queryState.Latitude = { projections: [measureProjection(tableName, "Selected latitude")] };
        queryState.Longitude = { projections: [measureProjection(tableName, "Selected longitude")] };
    }
    if (options.geometry) {
        queryState.Geometry = { projections: [measureProjection(tableName, "Selected geometry")] };
    }
    const navigationProperties = {
        minZoom: { expr: {
            Literal: { Value: `${options.minZoom ?? 1}D` }
        } },
        homeView: { expr: {
            Literal: { Value: `'${options.homeView ?? "automatic"}'` }
        } },
        homeFocus: { expr: {
            Literal: { Value: `'${options.homeFocus ?? "automatic"}'` }
        } },
        maxZoom: { expr: {
            Literal: { Value: `${options.maxZoom ?? 8}D` }
        } },
        wheelSensitivity: { expr: {
            Literal: { Value: `${options.wheelSensitivity ?? 1}D` }
        } },
        showCenterProbe: { expr: {
            Literal: { Value: options.showCenterProbe === false ? "false" : "true" }
        } },
        showResetControl: { expr: {
            Literal: { Value: options.showResetControl === false ? "false" : "true" }
        } },
        showGestureHelp: { expr: {
            Literal: { Value: options.showGestureHelp === false ? "false" : "true" }
        } },
        showNoDataBackdrop: { expr: {
            Literal: { Value: options.showNoDataBackdrop === false ? "false" : "true" }
        } }
    };
    if (Object.hasOwn(options, "navigationMode")) {
        navigationProperties.enabled = { expr: {
            Literal: { Value: `'${options.navigationMode}'` }
        } };
    } else if (Object.hasOwn(options, "navigationEnabled")) {
        navigationProperties.enabled = { expr: {
            Literal: { Value: options.navigationEnabled ? "true" : "false" }
        } };
    }
    if (options.fallbackEntityKey) {
        navigationProperties.fallbackEntityKey = { expr: {
            Literal: { Value: `'${options.fallbackEntityKey}'` }
        } };
    }
    return {
        $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.7.0/schema.json",
        name: visual.name,
        position: options.position ?? { x: 40, y: 40, z: 0, height: 800, width: 1520, tabOrder: 0 },
        visual: {
            visualType: guid,
            query: { queryState },
            objects: {
                data: [{
                    properties: {
                        normalization: { expr: {
                            Literal: { Value: `'${options.normalization ?? "shareOfProfile"}'` }
                        } },
                        percentScale: { expr: {
                            Literal: { Value: `'${options.percentScale ?? "fraction"}'` }
                        } }
                    }
                }],
                layout: [{
                    properties: {
                        contextLayout: { expr: {
                            Literal: { Value: `'${options.contextLayout ?? "split"}'` }
                        } }
                    }
                }],
                context: [{
                    properties: {
                        mode: { expr: {
                            Literal: { Value: `'${options.contextMode ?? "none"}'` }
                        } },
                        pack: { expr: {
                            Literal: { Value: `'${options.contextPack ?? "worldCountries"}'` }
                        } },
                        worldDetail: { expr: {
                            Literal: { Value: `'${options.worldDetail ?? "110m"}'` }
                        } },
                        referenceDetail: { expr: {
                            Literal: { Value: `'${options.referenceDetail ?? "standard"}'` }
                        } },
                        showPhysicalLayers: { expr: {
                            Literal: { Value: options.showPhysicalLayers === false ? "false" : "true" }
                        } },
                        showLabels: { expr: {
                            Literal: { Value: options.showLabels === false ? "false" : "true" }
                        } },
                        labelDensity: { expr: {
                            Literal: { Value: `'${options.labelDensity ?? "balanced"}'` }
                        } },
                        showGraticule: { expr: {
                            Literal: { Value: options.showGraticule === false ? "false" : "true" }
                        } },
                        packKeyMode: { expr: {
                            Literal: { Value: `'${options.packKeyMode ?? "auto"}'` }
                        } }
                    }
                }],
                diagnostics: [{
                    properties: {
                        showDiagnostics: { expr: { Literal: { Value: "true" } } }
                    }
                }],
                interaction: [{
                    properties: {
                        mode: { expr: {
                            Literal: { Value: `'${options.interactionMode ?? "reportSelection"}'` }
                        } }
                    }
                }],
                navigation: [{
                    properties: navigationProperties
                }]
            },
            drillFilterOtherVisuals: true
        }
    };
}

fs.rmSync(sampleRoot, { recursive: true, force: true });

const totalRows = TABLE_IDS.reduce((total, tableId) => total + tableRows(tableId).length, 0);

writeText(path.join(sampleRoot, "README.md"), `# Atlyn Profile Lens offline PBIP sample — demographics and community profiles

Generated by \`npm run sample:pbip\`. Fourteen pages open on a populated profile and retain the full
engineering coverage of Atlyn Profile Lens over openly synthetic demographic data.

1. **World community profiles** — Large 16:9 focus lens over the offline World 50m basemap. Every country in the packaged cartography is bound, Home centres on bound data, and a fallback Entity keeps the profile populated when the probe crosses open ocean. Drag to move, scroll or pinch to zoom, and press Home or use Reset view to return.
2. **Residents by age band** — Profile-only view of residents across the five age bands.
3. **Census periods and urban or rural settlement** — Two census periods, an urban and rural series, and all six community indicators.
4. **Nongeographic grid and hex community matrices** — Generated matrix layouts for comparison without geographic boundaries.
5. **Bound WGS84 community points** — Latitude and longitude community points with a locator inset.
6. **Bound district boundary polygons (WKT)** — Bound WKT district polygons under the focus lens.
7. **Global demographics: world countries (110m)** — Natural Earth 110m boundaries joined on exact ISO alpha-3 keys.
8. **Regional demographics: US states and equivalents** — All 56 Census state and equivalent GEOIDs are bound, with fixed-width boundaries, state abbreviations, and labelled frames for Alaska, Hawaii, Puerto Rico, USVI, American Samoa, Guam, and Northern Mariana Islands. Insets are repositioned and rescaled; distance and area are not comparable.
9. **Local demographics: US counties and equivalents** — A multi-hundred county subset covering sixteen states and equivalents, including every island area, over the complete county backdrop.
10. **Viewport lens navigation (world 50m probe)** — Probe-driven camera navigation with paired local-only and report-selection visuals.
11. **Six community indicators at once** — Residents, income, education, health coverage, labor force, and housing cost burden together.
12. **Normalization modes side by side** — Raw, share of profile, share within series, index to maximum, and already percent.
13. **Engineering diagnostics: malformed and duplicate keys** — The only page that supplies padded, unmatched, case-folded, and duplicate keys, so every customer-facing page stays free of rejection warnings.
14. **Progressive authoring landing** — Field-well authoring guidance with no bound fields.

The semantic model contains only synthetic DAX \`DATATABLE\` tables (${totalRows} rows across
${TABLE_IDS.length} tables). Values are produced by a deterministic function of the geographic key
and reproduce no real statistical source. Geographic keys are read from the context packs that ship
inside the visual, so every join is exact by construction. The project has no data source,
credentials, refresh, file access, or network dependency.

Open \`${sampleName}.pbip\` in Power BI Desktop. If the generator found \`dist\`, the report embeds
that packaged visual for offline use. This repository does not produce or claim a PBIX.
`);

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
    for (const visual of page.visuals) {
        writeJson(
            path.join(reportRoot, "definition", "pages", page.name, "visuals", visual.name, "visual.json"),
            visualJson(visual)
        );
    }
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
        ...TABLE_IDS.flatMap((tableId) => [`ref table ${TABLES[tableId].name}`, ""])
    ].join("\n")
);
for (const tableId of TABLE_IDS) {
    writeText(
        path.join(modelRoot, "definition", "tables", `${TABLES[tableId].name}.tmdl`),
        tableTmdl(tableId)
    );
}

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
})().then(async () => {
    const integrity = writeSampleIntegrity({
        root,
        sampleRoot,
        generatorPath: __filename,
        guid
    });
    const parity = await verifySampleResourceParity({
        packagePath,
        sampleRoot,
        guid
    });
    console.log(`Sample PBIP written to samples/${sampleName} (${totalRows} synthetic rows).`);
    console.log(`Sample tree SHA-256: ${integrity.projectTree.sha256}`);
    console.log(`Embedded resource SHA-256: ${parity.payload.sha256} (${parity.embedded.length} copy).`);
}).catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
});
