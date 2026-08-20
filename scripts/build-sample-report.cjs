/**
 * Builds the offline PBIP sample.
 *
 * The sample is authored as source, not as a native .pbix: a PBIP project can be produced and
 * validated offline, while producing and reopening a genuine .pbix remains a manual Power BI
 * Desktop step. The semantic model is a DAX calculated table, so the project has no data source,
 * needs no credentials and needs no refresh. Features a rich, realistic demographics and community
 * indicator model across 14 showcase pages.
 *
 * Usage: node scripts/build-sample-report.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { writeSampleIntegrity } = require("./sample-integrity.cjs");
const { verifySampleResourceParity } = require("./sample-resource-parity.cjs");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "pbiviz.json"), "utf8"));
const guid = manifest.visual.guid;
const sampleName = "AtlynProfileLensSample";
const sampleRoot = path.join(root, "samples", sampleName);
const reportRoot = path.join(sampleRoot, `${sampleName}.Report`);
const modelRoot = path.join(sampleRoot, `${sampleName}.SemanticModel`);
const table = "ProfileFacts";

const ENTITIES = [
    "Product A", "Team B", "Facility C", "Seat 04", "Unit E",
    "Unit F", "Unit G", "Unit H", "Unit I"
];
const WORLD_KEYS = ["USA", "CAN", "MEX", "NE:KOS", "FRA", "NOR", "NE:SOL", " USA ", "fra"];
const VIEWPORT_WORLD_KEYS = ["WLD", "DZA", "MLI", "NER", "TCD", "NGA", "CMR", "CAF", "COD"];
const STATE_KEYS = ["06", "60", "72", "78", "11", "66", "69", "XX", "06"];
const COUNTY_KEYS = [
    "06037", "60010", "72001", "78010", "11001", "66010", "69085", " 06037", "06037"
];
const PERIODS = ["Period 1", "Period 2"];
const BANDS = ["Band 1", "Band 2", "Band 3", "Band 4", "Band 5"];
const SERIES = ["Series X", "Series Y"];
const METRICS = ["Metric A", "Metric B", "Metric C", "Metric D", "Metric E", "Metric F"];
const LATITUDES = [47.61, 40.71, 51.51, -33.87, 48.86, 59.91, -9.43, 35.68, 43.30];
const LONGITUDES = [-122.33, -74.01, -0.13, 151.21, 2.35, 10.75, 159.96, 139.69, 5.37];
const GEOMETRIES = [
    "POLYGON ((-122.36 47.59, -122.30 47.59, -122.30 47.63, -122.36 47.63, -122.36 47.59))",
    "POLYGON ((-74.04 40.69, -73.98 40.69, -73.98 40.73, -74.04 40.73, -74.04 40.69))",
    "POLYGON ((-0.16 51.49, -0.10 51.49, -0.10 51.53, -0.16 51.53, -0.16 51.49))",
    "POLYGON ((151.18 -33.89, 151.24 -33.89, 151.24 -33.85, 151.18 -33.85, 151.18 -33.89))",
    "POLYGON ((2.32 48.84, 2.38 48.84, 2.38 48.88, 2.32 48.88, 2.32 48.84))",
    "POLYGON ((10.72 59.89, 10.78 59.89, 10.78 59.93, 10.72 59.93, 10.72 59.89))",
    "POLYGON ((159.93 -9.45, 159.99 -9.45, 159.99 -9.41, 159.93 -9.41, 159.93 -9.45))",
    "POLYGON ((139.66 35.66, 139.72 35.66, 139.72 35.70, 139.66 35.70, 139.66 35.66))",
    "POLYGON ((5.34 43.28, 5.40 43.28, 5.40 43.32, 5.34 43.32, 5.34 43.28))"
];

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
    // Seed for deterministic variety across entities and series
    const seed = ((entityIndex + 1) * 31 + (periodIndex + 1) * 17 + (seriesIndex + 1) * 13) % 100;
    const factor = 1 + (seed - 50) / 400; // 0.875 to 1.125 variation

    switch (metricIndex) {
        case 0: {
            // Metric A: Population Distribution by Age Band (0-17, 18-34, 35-49, 50-64, 65+)
            // Typical population pyramid/bell curve across 5 age bands: [18.5%, 24.2%, 22.1%, 19.8%, 15.4%]
            const baseAgeShares = [18.5, 24.2, 22.1, 19.8, 15.4];
            const val = baseAgeShares[bandIndex] * factor + (seriesIndex === 0 ? 1.2 : -1.2);
            return Math.round(val * 10) / 10;
        }
        case 1: {
            // Metric B: Household Income Brackets (<$35k, $35k-$74k, $75k-$124k, $125k-$199k, $200k+)
            // Right-skewed household income distribution: [14.2%, 26.5%, 29.8%, 18.1%, 11.4%]
            const baseIncomeShares = [14.2, 26.5, 29.8, 18.1, 11.4];
            const val = baseIncomeShares[bandIndex] * factor + (periodIndex === 1 ? (bandIndex - 2) * 1.5 : 0);
            return Math.round(val * 10) / 10;
        }
        case 2: {
            // Metric C: Educational Attainment (Less than HS, HS Grad, Some College, Bachelor's, Graduate)
            // Distribution: [8.4%, 27.1%, 28.3%, 22.8%, 13.4%]
            const baseEduShares = [8.4, 27.1, 28.3, 22.8, 13.4];
            const val = baseEduShares[bandIndex] * factor;
            return Math.round(val * 10) / 10;
        }
        case 3: {
            // Metric D: Community Health Indicators (Preventive Care, Physical Activity, Chronic Mgmt, Mental Wellness, Care Access)
            // Health index scores out of 100
            const baseHealthScores = [74.5, 68.2, 81.0, 72.4, 86.8];
            const val = (baseHealthScores[bandIndex] + (entityIndex % 4) * 3) * factor;
            return Math.round(val * 10) / 10;
        }
        case 4: {
            // Metric E: Labor Force & Economic Participation Rate (%)
            const baseLaborRates = [62.4, 83.5, 86.2, 71.8, 19.4];
            const val = baseLaborRates[bandIndex] * factor;
            return Math.round(val * 10) / 10;
        }
        case 5: {
            // Metric F: Housing & Community Infrastructure Index (Affordability & Quality quintiles)
            const baseHousingIndex = [52.1, 64.8, 78.3, 85.0, 91.2];
            const val = baseHousingIndex[bandIndex] * factor;
            return Math.round(val * 10) / 10;
        }
        default: {
            const shape = 100 - Math.abs(bandIndex - 2) * 18;
            return Math.round((shape * factor + metricIndex * 5) * 10) / 10;
        }
    }
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
                        `        {"${entity}", "${WORLD_KEYS[entityIndex]}", `
                        + `"${VIEWPORT_WORLD_KEYS[entityIndex]}", `
                        + `"${STATE_KEYS[entityIndex]}", "${COUNTY_KEYS[entityIndex]}", `
                        + `"${period}", "${band}", ${bandIndex + 1}, "${series}", `
                        + `${values.join(", ")}, `
                        + `${LATITUDES[entityIndex]}, ${LONGITUDES[entityIndex]}, `
                        + `"${GEOMETRIES[entityIndex]}"}`
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
        "/// Offline synthetic sample data for Atlyn Profile Lens: Demographics & Community Profile Demo.",
        "/// Defined as a DAX calculated table so the model has no data source, no credentials and no refresh.",
        "/// Features 6 realistic demographic metric dimensions across population, income, education, health, labor, and housing:",
        "///   - Metric A: Population Distribution by Age Band (0-17, 18-34, 35-49, 50-64, 65+)",
        "///   - Metric B: Household Income Brackets (<$35k, $35k-$74k, $75k-$124k, $125k-$199k, $200k+)",
        "///   - Metric C: Educational Attainment (Less than HS, HS Grad, Some College, Bachelor's, Graduate)",
        "///   - Metric D: Community Health Indicators (Preventive Care, Physical Activity, Chronic Mgmt, Mental Wellness, Care Access)",
        "///   - Metric E: Labor Force & Economic Participation Rate (%)",
        "///   - Metric F: Housing & Community Infrastructure Index (Affordability & Quality quintiles)",
        `table ${table}`,
        "",
        "\tcolumn Entity",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [Entity]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        "\tcolumn WorldKey",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [WorldKey]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        "\tcolumn ViewportWorldKey",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [ViewportWorldKey]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        "\tcolumn StateKey",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [StateKey]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        "\tcolumn CountyKey",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [CountyKey]",
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
        "\tcolumn Latitude",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [Latitude]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        "\tcolumn Longitude",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [Longitude]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        "\tcolumn Geometry",
        "\t\tsummarizeBy: none",
        "\t\tisNameInferred",
        "\t\tsourceColumn: [Geometry]",
        "",
        "\t\tannotation SummarizationSetBy = Automatic",
        "",
        `\tmeasure 'Context value' = SUM(${table}[Metric A])`,
        "",
        `\tmeasure 'Selected latitude' = SELECTEDVALUE(${table}[Latitude])`,
        "",
        `\tmeasure 'Selected longitude' = SELECTEDVALUE(${table}[Longitude])`,
        "",
        `\tmeasure 'Selected geometry' = SELECTEDVALUE(${table}[Geometry])`,
        "",
        `\tmeasure 'Population Distribution' = SUM(${table}[Metric A])`,
        "",
        `\tmeasure 'Household Income Brackets' = SUM(${table}[Metric B])`,
        "",
        `\tmeasure 'Educational Attainment' = SUM(${table}[Metric C])`,
        "",
        `\tmeasure 'Community Health Indicators' = SUM(${table}[Metric D])`,
        "",
        `\tmeasure 'Labor Force Participation' = SUM(${table}[Metric E])`,
        "",
        `\tmeasure 'Housing & Infrastructure Index' = SUM(${table}[Metric F])`,
        "",
        `\tpartition ${table} = calculated`,
        "\t\tmode: import",
        "\t\tsource =",
        "\t\t\t\tDATATABLE(",
        '\t\t\t\t    "Entity", STRING,',
        '\t\t\t\t    "WorldKey", STRING,',
        '\t\t\t\t    "ViewportWorldKey", STRING,',
        '\t\t\t\t    "StateKey", STRING,',
        '\t\t\t\t    "CountyKey", STRING,',
        '\t\t\t\t    "Period", STRING,',
        '\t\t\t\t    "Band", STRING,',
        '\t\t\t\t    "BandOrder", INTEGER,',
        '\t\t\t\t    "Series", STRING,',
        ...METRICS.map((metric) => `\t\t\t\t    "${metric}", DOUBLE,`),
        '\t\t\t\t    "Latitude", DOUBLE,',
        '\t\t\t\t    "Longitude", DOUBLE,',
        '\t\t\t\t    "Geometry", STRING,',
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

function measureProjection(property) {
    return {
        field: {
            Measure: {
                Expression: { SourceRef: { Entity: table } },
                Property: property
            }
        },
        queryRef: `${table}.${property}`,
        nativeQueryRef: property
    };
}

function visualJson(name, hierarchyProperties, withSeries, metrics, options = {}) {
    const queryState = {
        Hierarchy: { projections: hierarchyProperties.map((property) => projection(property, false)) },
        Profiles: {
            projections: metrics.map((metric) =>
                options.measureProfiles ? measureProjection(metric) : projection(metric, true))
        }
    };
    if (withSeries) {
        queryState.Series = { projections: [projection("Series", false)] };
    }
    if (options.contextValue) {
        queryState.ContextValue = { projections: [measureProjection("Context value")] };
    }
    if (options.coordinates) {
        queryState.Latitude = { projections: [measureProjection("Selected latitude")] };
        queryState.Longitude = { projections: [measureProjection("Selected longitude")] };
    }
    if (options.geometry) {
        queryState.Geometry = { projections: [measureProjection("Selected geometry")] };
    }
    const navigationProperties = {
        minZoom: { expr: {
            Literal: { Value: `${options.minZoom ?? 1}D` }
        } },
        homeView: { expr: {
            Literal: { Value: `'${options.homeView ?? "automatic"}'` }
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
        name,
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

const pages = [
    {
        name: "pageHero",
        displayName: "1 - Explore World Community Profiles",
        visuals: [{
            name: "visualHeroWorld",
            hierarchy: ["ViewportWorldKey", "Period", "Band"],
            series: true,
            metrics: [
                "Population Distribution",
                "Household Income Brackets",
                "Educational Attainment"
            ],
            options: {
                measureProfiles: true,
                contextMode: "builtInPack",
                contextPack: "worldCountries",
                worldDetail: "50m",
                referenceDetail: "full",
                showPhysicalLayers: true,
                showLabels: true,
                labelDensity: "detailed",
                showGraticule: true,
                packKeyMode: "canonical",
                contextValue: true,
                contextLayout: "focusLens",
                homeView: "automatic",
                fallbackEntityKey: "WLD",
                interactionMode: "localOnly",
                position: { x: 24, y: 24, z: 0, height: 852, width: 1552, tabOrder: 0 }
            }
        }]
    },
    {
        name: "pageProfileOnly",
        displayName: "2 - Demographic profile: Population by Age Band",
        visuals: [{
            name: "visualEntityBand",
            hierarchy: ["Entity", "Band"],
            series: false,
            metrics: ["Metric A"]
        }]
    },
    {
        name: "pagePeriodSeries",
        displayName: "3 - Multi-period census and urban/rural series",
        visuals: [{
            name: "visualPeriodSeries",
            hierarchy: ["Entity", "Period", "Band"],
            series: true,
            metrics: METRICS
        }]
    },
    {
        name: "pageGeneratedLayouts",
        displayName: "4 - Nongeographic grid and hex community matrices",
        visuals: [
            {
                name: "visualGrid",
                hierarchy: ["Entity", "Band"],
                series: false,
                metrics: ["Metric A", "Metric B"],
                options: {
                    contextMode: "grid",
                    contextValue: true,
                    position: { x: 40, y: 40, z: 0, height: 800, width: 740, tabOrder: 0 }
                }
            },
            {
                name: "visualHex",
                hierarchy: ["Entity", "Band"],
                series: false,
                metrics: ["Metric A", "Metric B"],
                options: {
                    contextMode: "hex",
                    contextValue: true,
                    position: { x: 820, y: 40, z: 1, height: 800, width: 740, tabOrder: 1 }
                }
            }
        ]
    },
    {
        name: "pageBoundPoints",
        displayName: "5 - Bound WGS84 community points",
        visuals: [{
            name: "visualBoundPoints",
            hierarchy: ["Entity", "Band"],
            series: false,
            metrics: ["Metric A", "Metric B"],
            options: {
                contextMode: "points",
                contextValue: true,
                coordinates: true,
                contextLayout: "locatorInset"
            }
        }]
    },
    {
        name: "pageBoundPolygons",
        displayName: "6 - District boundary polygons (WKT)",
        visuals: [{
            name: "visualBoundPolygons",
            hierarchy: ["Entity", "Band"],
            series: false,
            metrics: ["Metric A", "Metric B"],
            options: {
                contextMode: "boundGeometry",
                contextValue: true,
                geometry: true,
                contextLayout: "focusLens"
            }
        }]
    },
    {
        name: "pageWorldPack",
        displayName: "7 - Global demographics: World countries (110m)",
        visuals: [{
            name: "visualWorldPack",
            hierarchy: ["WorldKey", "Band"],
            series: false,
            metrics: ["Metric A", "Metric B"],
            options: {
                contextMode: "builtInPack",
                contextPack: "worldCountries",
                worldDetail: "110m",
                packKeyMode: "canonical",
                contextValue: true
            }
        }]
    },
    {
        name: "pageStatePack",
        displayName: "8 - Regional demographics: US states & territories",
        visuals: [{
            name: "visualStatePack",
            hierarchy: ["StateKey", "Band"],
            series: false,
            metrics: ["Metric A", "Metric B"],
            options: {
                contextMode: "builtInPack",
                contextPack: "usStates",
                packKeyMode: "geoid2",
                contextValue: true
            }
        }]
    },
    {
        name: "pageCountyPack",
        displayName: "9 - Local demographics: US counties & equivalents",
        visuals: [{
            name: "visualCountyPack",
            hierarchy: ["CountyKey", "Band"],
            series: false,
            metrics: ["Metric A", "Metric B"],
            options: {
                contextMode: "builtInPack",
                contextPack: "usCounties",
                packKeyMode: "geoid5",
                contextValue: true
            }
        }]
    },
    {
        name: "pageViewportLens",
        displayName: "10 - Viewport lens navigation (World 50m probe)",
        visuals: [
            {
                name: "visualViewportLocal",
                hierarchy: ["ViewportWorldKey", "Band"],
                series: false,
                metrics: ["Metric A", "Metric B"],
                options: {
                    contextMode: "builtInPack",
                    contextPack: "worldCountries",
                    worldDetail: "50m",
                    packKeyMode: "canonical",
                    contextValue: true,
                    fallbackEntityKey: "WLD",
                    interactionMode: "localOnly",
                    position: { x: 40, y: 40, z: 0, height: 800, width: 740, tabOrder: 0 }
                }
            },
            {
                name: "visualViewportSelection",
                hierarchy: ["ViewportWorldKey", "Band"],
                series: false,
                metrics: ["Metric A", "Metric B"],
                options: {
                    contextMode: "builtInPack",
                    contextPack: "worldCountries",
                    worldDetail: "50m",
                    packKeyMode: "canonical",
                    contextValue: true,
                    fallbackEntityKey: "WLD",
                    interactionMode: "reportSelection",
                    position: { x: 820, y: 40, z: 1, height: 800, width: 740, tabOrder: 1 }
                }
            }
        ]
    },
    {
        name: "pageSixProfiles",
        displayName: "11 - Six demographic profile indicators",
        visuals: [
            {
                name: "visualSixProfiles",
                hierarchy: ["Entity", "Period", "Band"],
                series: true,
                metrics: METRICS,
                options: {
                    contextMode: "grid",
                    contextValue: true,
                    position: { x: 40, y: 40, z: 0, height: 800, width: 740, tabOrder: 0 }
                }
            },
            {
                name: "visualLocalOnly",
                hierarchy: ["Entity", "Band"],
                series: false,
                metrics: ["Metric A", "Metric B"],
                options: {
                    contextMode: "hex",
                    contextValue: true,
                    interactionMode: "localOnly",
                    position: { x: 820, y: 40, z: 1, height: 800, width: 740, tabOrder: 1 }
                }
            }
        ]
    },
    {
        name: "pageNormalizations",
        displayName: "12 - Demographic normalization modes",
        visuals: [
            ["Raw", "raw", "fraction"],
            ["Profile share", "shareOfProfile", "fraction"],
            ["Series share", "shareWithinSeries", "fraction"],
            ["Maximum index", "indexToMaximum", "fraction"],
            ["Already percent", "alreadyPercent", "percent"]
        ].map(([label, normalization, percentScale], index) => ({
            name: `visual${label.replaceAll(" ", "")}`,
            hierarchy: ["Entity", "Band"],
            series: normalization === "shareWithinSeries",
            metrics: ["Metric A", "Metric B"],
            options: {
                normalization,
                percentScale,
                contextLayout: "profileOnly",
                position: {
                    x: 30 + (index % 3) * 520,
                    y: 30 + Math.floor(index / 3) * 430,
                    z: index,
                    height: 390,
                    width: 490,
                    tabOrder: index
                }
            }
        }))
    },
    {
        name: "pageWorldDiagnostics",
        displayName: "13 - Boundary diagnostics: World 50m exact keys",
        visuals: [{
            name: "visualWorldDiagnostics",
            hierarchy: ["WorldKey", "Band"],
            series: false,
            metrics: ["Metric A", "Metric B"],
            options: {
                contextMode: "builtInPack",
                contextPack: "worldCountries",
                worldDetail: "50m",
                packKeyMode: "isoAlpha3CaseFold",
                contextValue: true
            }
        }]
    },
    {
        name: "pageAuthoring",
        displayName: "14 - Progressive authoring landing",
        visuals: [{
            name: "visualProgressiveAuthoring",
            hierarchy: [],
            series: false,
            metrics: [],
            options: {
                contextLayout: "profileOnly"
            }
        }]
    }
];

fs.rmSync(sampleRoot, { recursive: true, force: true });

writeText(path.join(sampleRoot, "README.md"), `# Atlyn Profile Lens offline PBIP sample — Demographics & Community Profile Demo

Generated by \`npm run sample:pbip\`. The fourteen pages open with a polished exploration experience and retain the full engineering coverage of Atlyn Profile Lens with realistic synthetic demographic data:

1. **Explore World Community Profiles** — Large 16:9 focus lens over the professional offline World 50m basemap. Automatic Home resolves to Fill; bounded fixed-size labels, land, lakes, coastline, country boundaries, and a subtle graticule remain subordinate to the thematic countries and three synthetic demographic/community profiles. The center probe and period slider stay fixed. Drag to move, scroll or pinch to zoom, and press Home or use Reset view to return.
2. **Demographic Profile: Population by Age Band** — Profile-only view of population distribution across 5 age brackets (0-17, 18-34, 35-49, 50-64, 65+).
3. **Multi-Period Census and Urban/Rural Series** — Multi-period census tracking across series with all six demographic metric dimensions.
4. **Nongeographic Grid and Hex Community Matrices** — Auto-generated synthetic matrix layouts for demographic comparison without geographic boundary dependencies.
5. **Bound WGS84 Community Points** — Precise latitude/longitude community points with locator inset context layout.
6. **District Boundary Polygons (WKT)** — Bound WKT district polygon boundaries rendered with focus lens context layout.
7. **Global Demographics: World Countries (110m)** — Natural Earth 110m country boundaries with canonical ISO Alpha-3 key matching.
8. **Regional Demographics: US States & Territories** — High-resolution US State/territory census pack with 2-digit GEOID matching.
9. **Local Demographics: US Counties & Equivalents** — Complete US County census pack with 5-digit GEOID matching.
10. **Viewport Lens Navigation (World 50m Probe)** — Probe-driven camera navigation with drag, wheel, pinch, and keyboard controls. Paired local-only and report-selection visual layout over Natural Earth 50m with central African entities and fallback entity configuration.
11. **Six Demographic Profile Indicators** — Simultaneous visualization of Population, Household Income, Education Attainment, Community Health, Labor Force, and Housing metrics.
12. **Demographic Normalization Modes** — Side-by-side comparison of Raw counts, Share of Profile, Share within Series, Index to Maximum, and Already Percent normalizations.
13. **Boundary Diagnostics: World 50m Exact Keys** — Exact-key match/mismatch diagnostics, duplicate detection, and case-fold resolution.
14. **Progressive Authoring Landing** — Clean visual landing surface for field-well authoring demonstration.

The semantic model contains only a synthetic DAX \`DATATABLE\` with demographic metric dimensions (Population Distribution, Household Income, Educational Attainment, Community Health Indicators, Labor Force Participation, Housing & Infrastructure Index). Every metric is synthetic. The project has no data source, credentials, refresh, file access, or network dependency. Latitude, longitude, geometry, and context measures are projections over the same synthetic rows.

Open \`${sampleName}.pbip\` in Power BI Desktop. If the generator found \`dist\`, the report embeds that packaged visual for offline use. This repository does not produce or claim a PBIX.
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
            visualJson(visual.name, visual.hierarchy, visual.series, visual.metrics, visual.options)
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
    console.log(`Sample PBIP written to samples/${sampleName} (${buildRows().length} synthetic rows).`);
    console.log(`Sample tree SHA-256: ${integrity.projectTree.sha256}`);
    console.log(`Embedded resource SHA-256: ${parity.payload.sha256} (${parity.embedded.length} copy).`);
}).catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
});
