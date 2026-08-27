/**
 * Declarative definition of the offline PBIP sample: synthetic model and demo page configuration.
 *
 * This module is deliberately free of side effects so the PBIP generator and the packaged-Chromium
 * demo-page audit consume exactly the same definition. Requiring it never writes a file.
 *
 * Every geographic key is read from the generated context packs that ship inside the visual, so the
 * demo joins on exact provider-canonical keys by construction and cannot drift from the cartography.
 * All values are openly synthetic: they are produced by a deterministic function of the key, so the
 * same repository state always yields the same sample, and no observation from any real source is
 * reproduced here.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packRoot = path.join(root, "src", "context", "packs", "generated");

function packProperties(id) {
    const artifact = JSON.parse(fs.readFileSync(path.join(packRoot, `${id}.pack.json`), "utf8"));
    return artifact.topology.objects.features.geometries.map((geometry) => geometry.properties);
}

const worldFeatures = (() => {
    const seen = new Map();
    for (const id of ["world-countries-110m", "world-countries-50m"]) {
        for (const properties of packProperties(id)) {
            if (!seen.has(properties.canonicalKey)) {
                seen.set(properties.canonicalKey, properties.name);
            }
        }
    }
    return [...seen.entries()]
        .map(([key, name]) => ({ key, name }))
        .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
})();

const stateFeatures = packProperties("us-states-2025-5m")
    .map((properties) => ({ key: properties.canonicalKey, name: properties.name }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

const countyFeatures = packProperties("us-counties-2025-5m")
    .map((properties) => ({
        key: properties.canonicalKey,
        name: `${properties.name}, ${properties.status}`
    }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

const COMMUNITIES = [
    "Riverbend District",
    "Harbor Heights",
    "Cedar Mill",
    "Northgate",
    "Lakeshore",
    "Old Town",
    "Westfield",
    "Summit Park",
    "Mill Creek"
];

const AGE_BANDS = ["0 to 17", "18 to 34", "35 to 49", "50 to 64", "65 and over"];
const PERIODS = ["2010", "2020"];
const SETTLEMENTS = ["Urban", "Rural"];

const MEASURE_COLUMNS = [
    "Residents",
    "Median household income",
    "Degree attainment rate",
    "Health coverage rate",
    "Labor force participation",
    "Housing cost burden"
];

/** Base shape of each indicator across the five age bands. Synthetic, not sourced. */
const BASE_SHAPES = {
    "Residents": [21.8, 22.6, 19.4, 19.2, 17.0],
    "Median household income": [38.5, 72.4, 94.1, 88.6, 55.2],
    "Degree attainment rate": [4.2, 38.6, 41.3, 34.8, 28.1],
    "Health coverage rate": [95.4, 84.2, 88.7, 92.1, 98.6],
    "Labor force participation": [22.7, 82.4, 85.9, 71.3, 19.8],
    "Housing cost burden": [41.2, 36.8, 27.4, 24.1, 33.5]
};

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

/** Stable 32-bit string hash: identical inputs always produce identical sample values. */
function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index++) {
        value ^= text.charCodeAt(index);
        value = Math.imul(value, 16777619) >>> 0;
    }
    return value;
}

function syntheticValue(column, key, bandIndex, periodIndex, seriesIndex) {
    const shape = BASE_SHAPES[column];
    const spread = (hash(`${column}|${key}|${seriesIndex}`) % 241) / 1000 - 0.12;
    const drift = periodIndex * ((hash(`${column}|${key}`) % 61) / 1000 - 0.03);
    const tilt = seriesIndex === 1 ? -0.05 : 0.05;
    const value = shape[bandIndex] * (1 + spread + drift + tilt * (bandIndex - 2) * 0.4);
    return Math.round(Math.max(value, 0.1) * 10) / 10;
}

/**
 * Deliberately malformed and duplicate keys, isolated on the engineering diagnostics page so the
 * customer-facing pages stay free of rejection warnings.
 */
const DIAGNOSTIC_KEYS = [
    { key: "USA", note: "Exact canonical key" },
    { key: "DEU", note: "Exact canonical key" },
    { key: "FRA", note: "Rejected: duplicate after ASCII case fold" },
    { key: "fra", note: "Rejected: duplicate after ASCII case fold" },
    { key: " USA ", note: "Rejected: padded whitespace" },
    { key: "XX", note: "Rejected: no exact feature" },
    { key: " 06037", note: "Rejected: padded county GEOID in a country pack" },
    { key: "NE:KOS", note: "Rejected: not an ISO alpha-3 code" }
];

const TABLES = {
    community: {
        name: "CommunityProfiles",
        keyColumn: "Community",
        labelColumn: null,
        periods: PERIODS,
        series: SETTLEMENTS,
        measures: MEASURE_COLUMNS,
        rows: COMMUNITIES.map((name) => ({ key: name, label: name })),
        coordinates: true
    },
    world: {
        name: "WorldProfiles",
        keyColumn: "CountryKey",
        labelColumn: "Country",
        periods: PERIODS,
        series: SETTLEMENTS,
        measures: MEASURE_COLUMNS.slice(0, 3),
        rows: worldFeatures.map((entry) => ({ key: entry.key, label: entry.name })),
        coordinates: false
    },
    state: {
        name: "StateProfiles",
        keyColumn: "StateKey",
        labelColumn: "State",
        periods: [],
        series: [],
        measures: MEASURE_COLUMNS.slice(0, 2),
        rows: stateFeatures.map((entry) => ({ key: entry.key, label: entry.name })),
        coordinates: false
    },
    county: {
        name: "CountyProfiles",
        keyColumn: "CountyKey",
        labelColumn: "County",
        periods: [],
        series: [],
        measures: MEASURE_COLUMNS.slice(0, 2),
        rows: countyFeatures.map((entry) => ({ key: entry.key, label: entry.name })),
        coordinates: false
    },
    diagnostics: {
        name: "KeyDiagnostics",
        keyColumn: "SuppliedKey",
        labelColumn: "KeyNote",
        periods: [],
        series: [],
        measures: MEASURE_COLUMNS.slice(0, 2),
        rows: DIAGNOSTIC_KEYS.map((entry) => ({ key: entry.key, label: entry.note })),
        coordinates: false
    }
};

const MEASURES = {
    community: [
        { name: "Population by age band", expression: "SUM", column: "Residents" },
        { name: "Median income by age", expression: "AVERAGE", column: "Median household income" },
        { name: "Degree attainment by age", expression: "AVERAGE", column: "Degree attainment rate" }
    ],
    world: [
        { name: "Population by age band", expression: "SUM", column: "Residents" },
        { name: "Median income by age", expression: "AVERAGE", column: "Median household income" },
        { name: "Degree attainment by age", expression: "AVERAGE", column: "Degree attainment rate" }
    ],
    state: [
        { name: "Population by age band", expression: "SUM", column: "Residents" },
        { name: "Median income by age", expression: "AVERAGE", column: "Median household income" }
    ],
    county: [
        { name: "Population by age band", expression: "SUM", column: "Residents" },
        { name: "Median income by age", expression: "AVERAGE", column: "Median household income" }
    ],
    diagnostics: [
        { name: "Population by age band", expression: "SUM", column: "Residents" },
        { name: "Median income by age", expression: "AVERAGE", column: "Median household income" }
    ]
};

const COMMUNITY_FALLBACK = COMMUNITIES[0];
const WORLD_FALLBACK = "USA";
const STATE_FALLBACK = "06";
const COUNTY_FALLBACK = "06037";
const FOCUSED_PAGE_NAMES = ["pageHero", "pageCountyPack"];

const pages = [
    {
        name: "pageHero",
        displayName: "1 - World community profiles",
        visuals: [{
            name: "visualHeroWorld",
            table: "world",
            hierarchy: ["CountryKey", "Period", "AgeBand"],
            series: true,
            metrics: [
                "Population by age band",
                "Median income by age",
                "Degree attainment by age"
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
                homeFocus: "automatic",
                fallbackEntityKey: WORLD_FALLBACK,
                interactionMode: "localOnly",
                position: { x: 24, y: 24, z: 0, height: 852, width: 1552, tabOrder: 0 }
            }
        }]
    },
    {
        name: "pageProfileOnly",
        displayName: "2 - Residents by age band",
        visuals: [{
            name: "visualEntityBand",
            table: "community",
            hierarchy: ["Community", "AgeBand"],
            series: false,
            metrics: ["Residents"]
        }]
    },
    {
        name: "pagePeriodSeries",
        displayName: "3 - Census periods and urban or rural settlement",
        visuals: [{
            name: "visualPeriodSeries",
            table: "community",
            hierarchy: ["Community", "Period", "AgeBand"],
            series: true,
            metrics: MEASURE_COLUMNS
        }]
    },
    {
        name: "pageBoundPoints",
        displayName: "4 - Bound WGS84 community points",
        visuals: [{
            name: "visualBoundPoints",
            table: "community",
            hierarchy: ["Community", "AgeBand"],
            series: false,
            metrics: ["Residents", "Median household income"],
            options: {
                contextMode: "points",
                contextValue: true,
                coordinates: true,
                contextLayout: "locatorInset",
                fallbackEntityKey: COMMUNITY_FALLBACK
            }
        }]
    },
    {
        name: "pageWorldPack",
        displayName: "5 - Global demographics: world countries (110m)",
        visuals: [{
            name: "visualWorldPack",
            table: "world",
            hierarchy: ["CountryKey", "AgeBand"],
            series: false,
            metrics: ["Residents", "Median household income"],
            options: {
                contextMode: "builtInPack",
                contextPack: "worldCountries",
                worldDetail: "110m",
                packKeyMode: "canonical",
                contextValue: true,
                fallbackEntityKey: WORLD_FALLBACK
            }
        }]
    },
    {
        name: "pageStatePack",
        displayName: "6 - Regional demographics: US states and equivalents",
        visuals: [{
            name: "visualStatePack",
            table: "state",
            hierarchy: ["StateKey", "AgeBand"],
            series: false,
            metrics: ["Residents", "Median household income"],
            options: {
                contextMode: "builtInPack",
                contextPack: "usStates",
                packKeyMode: "geoid2",
                contextValue: true,
                contextLayout: "focusLens",
                referenceDetail: "full",
                labelDensity: "detailed",
                homeView: "fit",
                fallbackEntityKey: STATE_FALLBACK
            }
        }]
    },
    {
        name: "pageCountyPack",
        displayName: "7 - Local demographics: US counties and equivalents",
        visuals: [{
            name: "visualCountyPack",
            table: "county",
            hierarchy: ["CountyKey", "AgeBand"],
            series: false,
            metrics: ["Residents", "Median household income"],
            options: {
                contextMode: "builtInPack",
                contextPack: "usCounties",
                packKeyMode: "geoid5",
                contextValue: true,
                contextLayout: "focusLens",
                referenceDetail: "full",
                labelDensity: "detailed",
                homeView: "fit",
                fallbackEntityKey: COUNTY_FALLBACK
            }
        }]
    },
    {
        name: "pageViewportLens",
        displayName: "8 - Viewport lens navigation (world 50m probe)",
        visuals: [
            {
                name: "visualViewportLocal",
                table: "world",
                hierarchy: ["CountryKey", "AgeBand"],
                series: false,
                metrics: ["Residents", "Median household income"],
                options: {
                    contextMode: "builtInPack",
                    contextPack: "worldCountries",
                    worldDetail: "50m",
                    packKeyMode: "canonical",
                    contextValue: true,
                    fallbackEntityKey: WORLD_FALLBACK,
                    interactionMode: "localOnly",
                    position: { x: 40, y: 40, z: 0, height: 800, width: 740, tabOrder: 0 }
                }
            },
            {
                name: "visualViewportSelection",
                table: "world",
                hierarchy: ["CountryKey", "AgeBand"],
                series: false,
                metrics: ["Residents", "Median household income"],
                options: {
                    contextMode: "builtInPack",
                    contextPack: "worldCountries",
                    worldDetail: "50m",
                    packKeyMode: "canonical",
                    contextValue: true,
                    fallbackEntityKey: WORLD_FALLBACK,
                    interactionMode: "reportSelection",
                    position: { x: 820, y: 40, z: 1, height: 800, width: 740, tabOrder: 1 }
                }
            }
        ]
    },
    {
        name: "pageSixProfiles",
        displayName: "9 - Six community indicators at once",
        visuals: [
            {
                name: "visualSixProfiles",
                table: "community",
                hierarchy: ["Community", "Period", "AgeBand"],
                series: true,
                metrics: MEASURE_COLUMNS,
                options: {
                    contextMode: "grid",
                    contextValue: true,
                    fallbackEntityKey: COMMUNITY_FALLBACK,
                    position: { x: 40, y: 40, z: 0, height: 800, width: 740, tabOrder: 0 }
                }
            },
            {
                name: "visualLocalOnly",
                table: "community",
                hierarchy: ["Community", "AgeBand"],
                series: false,
                metrics: ["Residents", "Median household income"],
                options: {
                    contextMode: "hex",
                    contextValue: true,
                    interactionMode: "localOnly",
                    fallbackEntityKey: COMMUNITY_FALLBACK,
                    position: { x: 820, y: 40, z: 1, height: 800, width: 740, tabOrder: 1 }
                }
            }
        ]
    },
    {
        name: "pageNormalizations",
        displayName: "10 - Normalization modes side by side",
        visuals: [
            ["Raw", "raw", "fraction"],
            ["Profile share", "shareOfProfile", "fraction"],
            ["Series share", "shareWithinSeries", "fraction"],
            ["Maximum index", "indexToMaximum", "fraction"],
            ["Already percent", "alreadyPercent", "percent"]
        ].map(([label, normalization, percentScale], index) => ({
            name: `visual${label.replaceAll(" ", "")}`,
            table: "community",
            hierarchy: ["Community", "AgeBand"],
            series: normalization === "shareWithinSeries",
            metrics: ["Residents", "Median household income"],
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
    }
];

/** Rows of one table, in the exact order the DATATABLE emits them. */
function tableRows(tableId) {
    const table = TABLES[tableId];
    const periods = table.periods.length > 0 ? table.periods : [null];
    const series = table.series.length > 0 ? table.series : [null];
    const rows = [];
    table.rows.forEach((entry, entryIndex) => {
        periods.forEach((period, periodIndex) => {
            AGE_BANDS.forEach((band, bandIndex) => {
                series.forEach((settlement, seriesIndex) => {
                    rows.push({
                        entryIndex,
                        key: entry.key,
                        label: entry.label,
                        period,
                        band,
                        bandOrder: bandIndex + 1,
                        settlement,
                        values: table.measures.map((column) =>
                            syntheticValue(column, entry.key, bandIndex, periodIndex, seriesIndex))
                    });
                });
            });
        });
    });
    return rows;
}

/** Entity keys a visual binds at the first hierarchy level, in model order. */
function entityKeysFor(visual) {
    if (visual.hierarchy.length === 0) {
        return [];
    }
    return TABLES[visual.table].rows.map((entry) => entry.key);
}

module.exports = {
    AGE_BANDS,
    COMMUNITIES,
    DIAGNOSTIC_KEYS,
    FOCUSED_PAGE_NAMES,
    GEOMETRIES,
    LATITUDES,
    LONGITUDES,
    MEASURES,
    MEASURE_COLUMNS,
    PERIODS,
    SETTLEMENTS,
    TABLES,
    entityKeysFor,
    fallbacks: {
        community: COMMUNITY_FALLBACK,
        world: WORLD_FALLBACK,
        state: STATE_FALLBACK,
        county: COUNTY_FALLBACK
    },
    pages,
    syntheticValue,
    tableRows
};
