import { expect, test, Page } from "@playwright/test";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Packaged-Chromium demo-page audit.
 *
 * Every data-bearing configuration in the generated PBIP sample is mounted on the packaged bundle
 * and asserted to render a populated profile. This converts "the demo looks broken" from a
 * subjective report into a failing test: a page that opens with zero profile marks, or that paints
 * an orphan chart skeleton with no bars, fails the build.
 *
 * The page configuration is imported from the same side-effect-free module the PBIP generator uses,
 * so the audit cannot drift from the shipped sample.
 */
const requireCjs = createRequire(__filename);

interface VisualOptions {
    readonly [key: string]: unknown;
    readonly position?: { readonly width: number; readonly height: number };
}

interface SampleVisual {
    readonly name: string;
    readonly table: string;
    readonly hierarchy: readonly string[];
    readonly series: boolean;
    readonly metrics: readonly string[];
    readonly options?: VisualOptions;
}

interface SamplePage {
    readonly name: string;
    readonly displayName: string;
    readonly visuals: readonly SampleVisual[];
}

interface SampleDefinition {
    readonly AGE_BANDS: readonly string[];
    readonly PERIODS: readonly string[];
    readonly SETTLEMENTS: readonly string[];
    readonly GEOMETRIES: readonly string[];
    readonly LATITUDES: readonly number[];
    readonly LONGITUDES: readonly number[];
    readonly pages: readonly SamplePage[];
    entityKeysFor(visual: SampleVisual): readonly string[];
}

const definition = requireCjs(
    resolve(__dirname, "..", "scripts", "sample-definition.cjs")
) as SampleDefinition;

const root = resolve(__dirname, "..");
const probeDirectory = resolve(root, ".tmp", "probe");
const bundlePath = resolve(probeDirectory, "visual.js");
const stylePath = resolve(probeDirectory, "visual.css");
const harnessPath = resolve(__dirname, "probe-harness", "harness.js");
const resourcesPath = resolve(root, "stringResources", "en-US", "resources.resjson");

const OPTION_PASSTHROUGH = [
    "contextMode",
    "contextPack",
    "worldDetail",
    "referenceDetail",
    "showPhysicalLayers",
    "showLabels",
    "labelDensity",
    "showGraticule",
    "packKeyMode",
    "contextLayout",
    "interactionMode",
    "normalization",
    "percentScale",
    "homeView",
    "homeFocus",
    "fallbackEntityKey",
    "navigationMode",
    "navigationEnabled",
    "direction",
    "locale"
] as const;

interface Audit {
    readonly marks: number;
    readonly emptyCards: number;
    readonly emptyMessages: number;
    readonly chartMarkedEmpty: boolean;
    readonly axisLines: number;
    readonly bandLabels: number;
    readonly headerSubtitle: string;
    readonly emptyText: string;
    readonly emptyGuidance: string;
    readonly status: string;
    readonly tableRows: number;
    readonly emptyBounds: { x: number; y: number; width: number; height: number } | null;
    readonly chartBounds: { width: number; height: number };
    readonly failed: number;
    readonly labelCap: number;
    readonly labelledArms: number;
    readonly armCount: number;
    readonly labels: ReadonlyArray<{
        kind: string;
        key: string;
        text: string;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    }>;
    readonly chartRect: { left: number; top: number; right: number; bottom: number } | null;
    readonly direction: string;
    readonly edgeAnchoredLabels: number;
}

const REMOTE_SCHEMES = ["http", "https", "ws", "wss"].map((scheme) => `${scheme}:`);

const externalRequests: string[] = [];
const observed: Array<{ page: string; visual: string; marks: number; empty: boolean }> = [];

test.beforeAll(() => {
    if (!existsSync(bundlePath)) {
        throw new Error(
            'The packaged bundle is missing. Run "npm run package" and then "npm run probe:build".'
        );
    }
});

test.afterAll(() => {
    const lines = observed.map((entry) =>
        `${entry.page}/${entry.visual}: ${entry.marks} marks`
        + `${entry.empty ? " (designed empty state)" : ""}`);
    console.log(`Demo page audit\n${lines.join("\n")}`);
});

function mountOptionsFor(visual: SampleVisual, width: number, height: number): Record<string, unknown> {
    const options = visual.options ?? {};
    const mountOptions: Record<string, unknown> = {
        width,
        height,
        entities: [...definition.entityKeysFor(visual)],
        periods: visual.hierarchy.includes("Period") ? [...definition.PERIODS] : [],
        bands: [...definition.AGE_BANDS],
        series: visual.series ? [...definition.SETTLEMENTS] : [],
        profiles: [...visual.metrics]
    };
    for (const key of OPTION_PASSTHROUGH) {
        if (Object.hasOwn(options, key)) {
            mountOptions[key] = options[key];
        }
    }
    if (options.geometry) {
        mountOptions.geometryTexts = [...definition.GEOMETRIES];
    }
    if (options.coordinates) {
        mountOptions.latitudes = [...definition.LATITUDES];
        mountOptions.longitudes = [...definition.LONGITUDES];
    }
    return mountOptions;
}

async function mount(page: Page, options: Record<string, unknown>): Promise<void> {
    await page.setContent(
        '<!doctype html><html><head><meta charset="utf-8"></head>'
        + '<body style="margin:0"><div id="visual-root"></div></body></html>'
    );
    await page.addStyleTag({ path: stylePath });
    await page.addScriptTag({ path: bundlePath });
    await page.evaluate(
        (resources) => {
            (window as unknown as { profileLensResources: unknown }).profileLensResources = resources;
        },
        JSON.parse(readFileSync(resourcesPath, "utf8"))
    );
    await page.addScriptTag({ path: harnessPath });
    await page.evaluate((mountOptions) =>
        (window as unknown as {
            mountProfileLens: (options: unknown) => boolean;
        }).mountProfileLens(mountOptions), options);
}

async function auditPage(page: Page): Promise<Audit> {
    return page.evaluate(() => {
        const root = document.getElementById("visual-root");
        if (!root) {
            throw new Error("The visual root is missing.");
        }
        const chart = root.querySelector("svg.profile-lens-profile-svg");
        const empty = chart?.querySelector(".profile-lens-empty") ?? null;
        const emptyBox = empty instanceof SVGGraphicsElement ? empty.getBBox() : null;
        const chartLayer = chart?.querySelector(".profile-lens-chart-layer") ?? null;
        const labelLayer = chart?.querySelector(".profile-lens-label-layer") ?? null;
        const failedEvents = (window as unknown as {
            profileLensEvents: { failed: number };
        }).profileLensEvents;
        return {
            marks: root.querySelectorAll(".profile-lens-target").length,
            emptyCards: root.querySelectorAll(".profile-lens-empty-card").length,
            emptyMessages: root.querySelectorAll(".profile-lens-empty-message").length,
            chartMarkedEmpty: chart?.getAttribute("data-empty") === "true",
            axisLines: chartLayer ? chartLayer.querySelectorAll("line").length : 0,
            bandLabels: labelLayer ? labelLayer.querySelectorAll("text").length : 0,
            headerSubtitle: root.querySelector(".profile-lens-header-subtitle")?.textContent ?? "",
            emptyText: [...root.querySelectorAll(".profile-lens-empty-message")]
                .map((node) => node.textContent ?? "")
                .join(" "),
            emptyGuidance: [...root.querySelectorAll(".profile-lens-empty-guidance")]
                .map((node) => node.textContent ?? "")
                .join(" "),
            status: root.querySelector(".profile-lens-status-summary")?.textContent ?? "",
            tableRows: root.querySelectorAll(".profile-lens-table tbody tr, table tbody tr").length,
            emptyBounds: emptyBox
                ? { x: emptyBox.x, y: emptyBox.y, width: emptyBox.width, height: emptyBox.height }
                : null,
            chartBounds: {
                width: Number(chart?.getAttribute("width") ?? 0),
                height: Number(chart?.getAttribute("height") ?? 0)
            },
            failed: failedEvents.failed,
            labelCap: Number(labelLayer?.getAttribute("data-label-cap") ?? 0),
            armCount: chartLayer ? chartLayer.querySelectorAll(".profile-lens-arm").length : 0,
            labelledArms: new Set(
                [...(labelLayer?.querySelectorAll('[data-label-kind="band"]') ?? [])]
                    .map((node) => (node.getAttribute("data-label-key") ?? "").split(":")[1])
            ).size,
            labels: [...(labelLayer?.querySelectorAll<SVGGraphicsElement>(
                ".profile-lens-chart-label"
            ) ?? [])].map((node) => {
                const rect = node.getBoundingClientRect();
                return {
                    kind: node.getAttribute("data-label-kind") ?? "",
                    key: node.getAttribute("data-label-key") ?? "",
                    text: node.textContent ?? "",
                    x1: rect.left,
                    y1: rect.top,
                    x2: rect.right,
                    y2: rect.bottom
                };
            }),
            chartRect: chart
                ? (() => {
                    const rect = chart.getBoundingClientRect();
                    return {
                        left: rect.left,
                        top: rect.top,
                        right: rect.right,
                        bottom: rect.bottom
                    };
                })()
                : null,
            direction: chart ? getComputedStyle(chart).direction : "",
            edgeAnchoredLabels: [...(labelLayer?.querySelectorAll(
                ".profile-lens-chart-label"
            ) ?? [])].filter((node) => {
                const anchor = node.getAttribute("text-anchor");
                return anchor === "start" || anchor === "end";
            }).length
        };
    });
}

/**
 * Readability assertions applied to every data-bearing demo page.
 *
 * The v1.8 audit found band labels on one arm out of six, labels hundreds of pixels from the bars
 * they named, and an unreadable "Band 5Band 4Band 3Band 2Band 1" run on the 490x390 tile. These
 * three properties are what make those defects impossible to reintroduce quietly.
 */
function assertReadableLabels(audit: Audit, label: string): void {
    expect(audit.labels.length, `${label} exceeded its label cap`)
        .toBeLessThanOrEqual(audit.labelCap);
    for (let left = 0; left < audit.labels.length; left++) {
        for (let right = left + 1; right < audit.labels.length; right++) {
            const a = audit.labels[left];
            const b = audit.labels[right];
            const overlaps = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
            expect(overlaps, `${label}: "${a.text}" overlaps "${b.text}"`).toBe(false);
        }
    }
    if (audit.chartRect) {
        for (const box of audit.labels) {
            expect(box.x1, `${label}: "${box.text}" escaped the chart`)
                .toBeGreaterThanOrEqual(audit.chartRect.left - 1);
            expect(box.x2, `${label}: "${box.text}" escaped the chart`)
                .toBeLessThanOrEqual(audit.chartRect.right + 1);
            expect(box.y1, `${label}: "${box.text}" escaped the chart`)
                .toBeGreaterThanOrEqual(audit.chartRect.top - 1);
            expect(box.y2, `${label}: "${box.text}" escaped the chart`)
                .toBeLessThanOrEqual(audit.chartRect.bottom + 1);
        }
    }
}

const dataVisuals = definition.pages.flatMap((page) =>
    page.visuals
        .filter((visual) => visual.hierarchy.length > 0 && visual.metrics.length > 0)
        .map((visual) => ({ page, visual })));

test.describe("packaged demo page audit", () => {
    test.beforeEach(async ({ page }) => {
        externalRequests.length = 0;
        page.on("request", (request) => {
            const url = request.url();
            if (REMOTE_SCHEMES.some((scheme) => url.startsWith(scheme))) {
                externalRequests.push(url);
            }
        });
    });

    test("every demo page configuration is enumerated", () => {
        expect(definition.pages).toHaveLength(14);
        expect(dataVisuals.length).toBeGreaterThanOrEqual(19);
    });

    for (const { page: samplePage, visual } of dataVisuals) {
        test(`${samplePage.name}/${visual.name} opens on a populated profile`, async ({ page }) => {
            const position = visual.options?.position;
            const width = Math.min(position?.width ?? 1520, 1552);
            const height = Math.min(position?.height ?? 800, 852);
            await mount(page, mountOptionsFor(visual, width, height));
            const audit = await auditPage(page);
            observed.push({
                page: samplePage.name,
                visual: visual.name,
                marks: audit.marks,
                empty: audit.chartMarkedEmpty
            });

            expect(audit.failed, `${visual.name} raised a rendering failure`).toBe(0);
            expect(
                audit.marks,
                `${samplePage.name}/${visual.name} rendered no profile marks`
            ).toBeGreaterThan(0);
            expect(audit.chartMarkedEmpty).toBe(false);
            expect(audit.emptyCards).toBe(0);
            assertReadableLabels(audit, `${samplePage.name}/${visual.name}`);
            if (audit.labelCap > 0 && audit.armCount > 0) {
                // v1.8 labelled arm 0 only, so a six-metric page shipped five unlabelled arms.
                expect(
                    audit.labelledArms,
                    `${samplePage.name}/${visual.name} left arms unlabelled`
                ).toBe(audit.armCount);
            }
            expect(externalRequests).toEqual([]);
        });
    }

    test("the authoring landing page renders guidance without a chart skeleton", async ({ page }) => {
        const landing = definition.pages.find((entry) => entry.name === "pageAuthoring");
        expect(landing).toBeDefined();
        await mount(page, {
            width: 1520,
            height: 800,
            entities: [],
            periods: [],
            bands: [],
            series: [],
            profiles: []
        });
        const audit = await auditPage(page);
        expect(audit.marks).toBe(0);
        expect(audit.axisLines).toBe(0);
        expect(audit.bandLabels).toBe(0);
        expect(await page.locator(".profile-lens-landing").count()).toBe(1);
        expect(externalRequests).toEqual([]);
    });

    test("an unbound probe shows the designed empty state and no orphan skeleton", async ({ page }) => {
        await mount(page, {
            width: 1280,
            height: 620,
            // Keys that exist in no packaged feature, and no fallback Entity, so the probe resolves
            // to no feature and the frame carries zero cells.
            entities: ["ZZA", "ZZB", "ZZC"],
            periods: [],
            bands: [...definition.AGE_BANDS],
            series: [],
            profiles: ["Residents", "Median household income"],
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            worldDetail: "110m",
            packKeyMode: "canonical",
            contextLayout: "focusLens"
        });
        const audit = await auditPage(page);

        expect(audit.marks).toBe(0);
        expect(audit.chartMarkedEmpty).toBe(true);
        // The orphan skeleton the audit found in v1.7: an axis line, floating band labels and
        // metric captions painted around zero bars.
        expect(audit.axisLines).toBe(0);
        expect(audit.bandLabels).toBe(0);
        expect(audit.emptyCards).toBe(1);
        expect(audit.emptyMessages).toBeGreaterThan(0);
        expect(audit.emptyBounds).not.toBeNull();
        expect(audit.emptyBounds!.width).toBeLessThanOrEqual(audit.chartBounds.width);
        expect(audit.emptyBounds!.height).toBeLessThanOrEqual(audit.chartBounds.height);
        // Existing semantics must survive: the card repeats the authoritative header state text,
        // and the status line plus the accessible table still describe the same state.
        expect(audit.emptyText.length).toBeGreaterThan(0);
        expect(audit.emptyGuidance.length).toBeGreaterThan(0);
        expect(audit.headerSubtitle).toContain(audit.emptyText);
        expect(audit.status.length).toBeGreaterThan(0);
        expect(audit.tableRows).toBeGreaterThan(0);
        expect(externalRequests).toEqual([]);
    });

    test("the empty state stays bounded across every density tier", async ({ page }) => {
        let emptyTiers = 0;
        for (const size of [
            { width: 1280, height: 620 },
            { width: 398, height: 298 },
            { width: 258, height: 198 },
            { width: 178, height: 138 },
            { width: 80, height: 80 }
        ]) {
            const label = `${size.width}x${size.height}`;
            await mount(page, {
                width: size.width,
                height: size.height,
                entities: ["ZZA", "ZZB"],
                periods: [],
                bands: [...definition.AGE_BANDS],
                series: [],
                profiles: ["Residents"],
                contextMode: "builtInPack",
                contextPack: "worldCountries",
                worldDetail: "110m",
                packKeyMode: "canonical",
                contextLayout: "focusLens"
            });
            const audit = await auditPage(page);
            expect(audit.failed, `${label} raised a failure`).toBe(0);
            if (audit.marks > 0) {
                // Smaller tiers drop the context surface entirely and fall back to the default
                // Entity profile, which is populated. There is nothing empty to bound.
                expect(audit.emptyCards, `${label} drew an empty card beside marks`).toBe(0);
                continue;
            }
            emptyTiers++;
            expect(audit.axisLines, `${label} drew an orphan axis`).toBe(0);
            expect(audit.bandLabels, `${label} drew orphan labels`).toBe(0);
            expect(audit.emptyCards, `${label} lost the empty state`).toBe(1);
            expect(audit.emptyBounds).not.toBeNull();
            expect(
                audit.emptyBounds!.width,
                `${label} overflowed the chart width`
            ).toBeLessThanOrEqual(audit.chartBounds.width + 0.5);
            expect(
                audit.emptyBounds!.height,
                `${label} overflowed the chart height`
            ).toBeLessThanOrEqual(audit.chartBounds.height + 0.5);
        }
        expect(emptyTiers, "no tier exercised the designed empty state").toBeGreaterThan(0);
        expect(externalRequests).toEqual([]);
    });

    test("every demo page stays readable when the tile is scaled down", async ({ page }) => {
        // Two mounts per data-bearing page, each re-injecting the packaged bundle. Inherently long,
        // so it gets its own budget rather than borrowing the default single-mount one.
        test.setTimeout(240000);
        const observed: Array<{ page: string; size: string; labels: number }> = [];
        for (const { page: samplePage, visual } of dataVisuals) {
            for (const size of [{ width: 490, height: 390 }, { width: 258, height: 198 }]) {
                await mount(page, mountOptionsFor(visual, size.width, size.height));
                const audit = await auditPage(page);
                const label = `${samplePage.name}/${visual.name} at ${size.width}x${size.height}`;
                expect(audit.failed, `${label} raised a failure`).toBe(0);
                assertReadableLabels(audit, label);
                observed.push({
                    page: `${samplePage.name}/${visual.name}`,
                    size: `${size.width}x${size.height}`,
                    labels: audit.labels.length
                });
            }
        }
        console.log(`Demo page label readability\n${observed
            .map((entry) => `${entry.page} ${entry.size}: ${entry.labels} labels`)
            .join("\n")}`);
        expect(externalRequests).toEqual([]);
    });

    test("every demo page stays readable right to left", async ({ page }) => {
        test.setTimeout(240000);
        const observed: Array<{ page: string; labels: number; edgeAnchored: number }> = [];
        for (const { page: samplePage, visual } of dataVisuals) {
            const position = visual.options?.position;
            const width = Math.min(position?.width ?? 1520, 1552);
            const height = Math.min(position?.height ?? 800, 852);
            await mount(page, {
                ...mountOptionsFor(visual, width, height),
                direction: "rtl"
            });
            const label = `${samplePage.name}/${visual.name} rtl`;
            const audit = await auditPage(page);
            expect(audit.failed, `${label} raised a failure`).toBe(0);
            expect(audit.direction, `${label} did not render right to left`).toBe("rtl");
            // Arm captions and scale annotations are the edge-anchored labels, and text-anchor is
            // resolved against direction, so these are exactly the labels an LTR-only box model
            // mispredicts. The audit measures painted rectangles, so it catches that directly.
            assertReadableLabels(audit, label);
            observed.push({
                page: `${samplePage.name}/${visual.name}`,
                labels: audit.labels.length,
                edgeAnchored: audit.edgeAnchoredLabels
            });
        }
        expect(
            observed.some((entry) => entry.edgeAnchored > 0),
            "no demo page exercised an edge-anchored label in RTL"
        ).toBe(true);
        console.log(`Demo page RTL readability\n${observed
            .map((entry) =>
                `${entry.page}: ${entry.labels} labels, ${entry.edgeAnchored} edge anchored`)
            .join("\n")}`);
        expect(externalRequests).toEqual([]);
    });

    test("data-bearing Home opens the world probe on a bound feature", async ({ page }) => {
        const world = definition.pages.find((entry) => entry.name === "pageWorldPack");
        const visual = world!.visuals[0];
        await mount(page, {
            ...mountOptionsFor(visual, 1280, 620),
            fallbackEntityKey: "",
            homeFocus: "dataBearing"
        });
        const bound = await auditPage(page);
        expect(bound.marks).toBeGreaterThan(0);
        expect(bound.chartMarkedEmpty).toBe(false);

        await mount(page, {
            ...mountOptionsFor(visual, 1280, 620),
            fallbackEntityKey: "",
            homeFocus: "sceneCenter"
        });
        const centered = await auditPage(page);
        // Scene center remains reachable and must still degrade to the designed empty state
        // rather than an orphan skeleton when it lands on open ocean.
        if (centered.marks === 0) {
            expect(centered.chartMarkedEmpty).toBe(true);
            expect(centered.axisLines).toBe(0);
            expect(centered.emptyCards).toBe(1);
        }
        expect(externalRequests).toEqual([]);
    });
});
