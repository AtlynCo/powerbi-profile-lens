import { expect, test, Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { feature } from "topojson-client";

const root = resolve(__dirname, "..");
const probeDirectory = resolve(root, ".tmp", "probe");
const bundlePath = resolve(probeDirectory, "visual.js");
const stylePath = resolve(probeDirectory, "visual.css");
const metaPath = resolve(probeDirectory, "bundle-meta.json");
const harnessPath = resolve(__dirname, "probe-harness", "harness.js");
const resourcesPath = resolve(root, "stringResources", "en-US", "resources.resjson");
const runtimeLicenseSource = readFileSync(resolve(root, "src", "runtimeLicenses.ts"), "utf8");
const runtimeLicenseMatch = runtimeLicenseSource.match(
    /export const RUNTIME_LICENSE_NOTICES = `([\s\S]*?)`;/
);
if (!runtimeLicenseMatch) {
    throw new Error("Canonical runtime license notice block is missing.");
}
const RUNTIME_LICENSE_NOTICES = runtimeLicenseMatch[1];
const RUNTIME_LICENSE_SHA256 = createHash("sha256")
    .update(RUNTIME_LICENSE_NOTICES.replace(/\r\n/g, "\n"))
    .digest("hex");
const generatedPacks = resolve(root, "src", "context", "packs", "generated");

function packKeys(filename: string): string[] {
    const artifact = JSON.parse(readFileSync(resolve(generatedPacks, filename), "utf8")) as {
        topology: {
            objects: { features: unknown };
        };
    };
    const collection = feature(
        artifact.topology as never,
        artifact.topology.objects.features as never
    ) as unknown as {
        features: Array<{ properties: { canonicalKey: string } }>;
    };
    return collection.features.map((entry) => entry.properties.canonicalKey);
}

const COUNTY_KEYS = packKeys("us-counties-2025-5m.pack.json");
const STATE_KEYS = packKeys("us-states-2025-5m.pack.json");
const WORLD_50_KEYS = packKeys("world-countries-50m.pack.json");

interface PickingMetrics {
    readonly elapsed: number;
    readonly mountElapsed: number;
    readonly moves: number;
    readonly sceneFeatures: number;
    readonly pickingReads: number;
    readonly candidateValidations: number;
    readonly targetMapLookups: number;
    readonly targetMapMisses: number;
    readonly resolvedHits: number;
    readonly pickedCandidatesDecoded: number;
    readonly localizedQueries: number;
    readonly localizedCandidateValidations: number;
    readonly maxLocalizedCandidatesExamined: number;
    readonly spatialBucketEntries: number;
    readonly spatialGlobalCandidates: number;
    readonly maxBucketOccupancy: number;
    readonly maxBucketsPerFeature: number;
    readonly scaled: boolean;
}

function assertCoherentPickingMetrics(metrics: PickingMetrics): void {
    if (metrics.pickingReads !== metrics.moves) {
        throw new Error("pickingReads must equal dispatched pointer moves");
    }
    if (metrics.targetMapLookups !== metrics.resolvedHits) {
        throw new Error("targetMapLookups must equal resolved hits");
    }
    if (metrics.targetMapMisses !== 0) {
        throw new Error("every resolved feature must have a precomputed target");
    }
    if (metrics.localizedQueries !== metrics.pickingReads) {
        throw new Error("every picking read must use the localized candidate index");
    }
    if (metrics.localizedCandidateValidations !== metrics.candidateValidations) {
        throw new Error("candidate validation counters must describe real localized work");
    }
    if (metrics.candidateValidations > metrics.pickingReads * 32) {
        throw new Error("candidate validation exceeded the strict fallback bound");
    }
    if (metrics.maxLocalizedCandidatesExamined > 32) {
        throw new Error("localized fallback examined too many candidates");
    }
    if (metrics.maxBucketOccupancy > 32 || metrics.spatialGlobalCandidates > 32) {
        throw new Error("spatial index candidate storage exceeded its fixed bound");
    }
    if (metrics.maxBucketsPerFeature !== 256) {
        throw new Error("spatial index per-feature expansion bound changed");
    }
    if (metrics.spatialBucketEntries > metrics.sceneFeatures * metrics.maxBucketsPerFeature) {
        throw new Error("spatial index storage exceeded its scene-derived bound");
    }
}

const SIZES = [
    { width: 1280, height: 620 },
    { width: 398, height: 298 },
    { width: 258, height: 198 },
    { width: 178, height: 138 },
    { width: 80, height: 80 }
];

const externalRequests: string[] = [];

test.beforeAll(() => {
    if (!existsSync(bundlePath)) {
        throw new Error(
            'The packaged bundle is missing. Run "npm run package" and then "npm run probe:build".'
        );
    }
});

async function mount(
    page: Page,
    options: Record<string, unknown> = {}
): Promise<void> {
    page.on("request", (request) => {
        const url = request.url();
        const remoteProtocols = ["http", "https", "ws", "wss"].map((scheme) => `${scheme}:`);
        if (remoteProtocols.some((scheme) => url.startsWith(scheme))) {
            externalRequests.push(url);
        }
    });
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
    await page.evaluate((mountOptions) => {
        return (window as unknown as {
            mountProfileLens: (options: unknown) => boolean;
        }).mountProfileLens(mountOptions);
    }, {
        width: 1280,
        height: 620,
        entities: ["Entity A", "Entity B", "Entity C"],
        periods: ["Period 1", "Period 2"],
        bands: ["Band 1", "Band 2", "Band 3", "Band 4", "Band 5"],
        series: ["Series X", "Series Y"],
        profiles: ["Metric A", "Metric B", "Metric C"],
        ...options
    });
}

test.describe("packaged visual in a real browser", () => {
    test("mounts the packaged bundle and completes the rendering lifecycle", async ({ page }) => {
        await mount(page);
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { jsBytes: number };
        expect(meta.jsBytes).toBeGreaterThan(1000);

        const events = await page.evaluate(() => (window as unknown as {
            profileLensEvents: { started: number; finished: number; failed: number };
        }).profileLensEvents);
        expect(events).toEqual({ started: 1, finished: 1, failed: 0, reason: null });

        await expect(page.locator("#visual-root .profile-lens")).toHaveCount(1);
        const licenseNotices = page.locator(".profile-lens-runtime-license-notices");
        await expect(licenseNotices).toHaveAttribute("hidden", "hidden");
        await expect(licenseNotices).toHaveAttribute(
            "data-notice-sha256",
            RUNTIME_LICENSE_SHA256
        );
        expect((await licenseNotices.textContent())?.replace(/\r\n/g, "\n"))
            .toBe(RUNTIME_LICENSE_NOTICES.replace(/\r\n/g, "\n"));
        await expect(page.locator(".profile-lens-target")).toHaveCount(5 * 3 * 2);
        await expect(page.locator(".profile-lens-table table")).toHaveCount(1);
    });

    test("preserves rejected raw values in packaged nonvisual representations", async ({ page }) => {
        await mount(page, {
            entities: ["Entity A"],
            periods: [],
            bands: ["Negative", "Infinite", "Text"],
            series: [],
            profiles: ["Metric A"],
            negativeFirstValue: true,
            nonFiniteSecondValue: true,
            nonNumericThirdValue: true
        });

        await expect(page.locator(".profile-lens-target").first())
            .toHaveAttribute("aria-label", /negative value -1,234\.5 unsupported/);
        await expect(page.locator(".profile-lens-table tbody tr").first().locator("td"))
            .toHaveText("negative value unsupported, raw -1,234.5");
        await expect(page.locator(".profile-lens-target").nth(1))
            .toHaveAttribute("aria-label", /non-finite value \u221e unsupported/);
        await expect(page.locator(".profile-lens-table tbody tr").nth(1).locator("td"))
            .toHaveText("non-finite value \u221e unsupported");
        await expect(page.locator(".profile-lens-target").nth(2))
            .toHaveAttribute("aria-label", /non-numeric value unsupported/);
        await expect(page.locator(".profile-lens-table tbody tr").nth(2).locator("td"))
            .toHaveText("non-numeric value unsupported");
        await expect(page.locator('[data-code="negativeProfileValues"]')).toContainText("1");
    });

    test("keeps every rendered element inside the visual root at each tile size", async ({ page }) => {
        await mount(page);
        for (const size of SIZES) {
            await page.evaluate(
                (viewport) => (window as unknown as {
                    resizeProfileLens: (width: number, height: number) => boolean;
                }).resizeProfileLens(viewport.width, viewport.height),
                size
            );
            const overflow = await page.evaluate(() => {
                const container = document.getElementById("visual-root") as HTMLElement;
                const bounds = container.getBoundingClientRect();
                const problems: string[] = [];
                const nodes = container.querySelectorAll("*");
                for (const node of Array.from(nodes)) {
                    // The screen reader only table is clipped out of the paint tree by design, so
                    // its descendants' layout boxes are not part of what the user can see. The
                    // container itself is still measured below.
                    if ((node as HTMLElement).closest(".profile-lens-table-sr") !== null) {
                        continue;
                    }
                    const rect = node.getBoundingClientRect();
                    if (rect.width === 0 && rect.height === 0) {
                        continue;
                    }
                    if (
                        rect.right > bounds.right + 1
                        || rect.bottom > bounds.bottom + 1
                        || rect.left < bounds.left - 1
                        || rect.top < bounds.top - 1
                    ) {
                        problems.push(`${node.nodeName}.${(node as HTMLElement).className || ""}`);
                    }
                }
                const srTable = container.querySelector(".profile-lens-table-sr") as HTMLElement | null;
                const srRect = srTable?.getBoundingClientRect();
                return {
                    problems: problems.slice(0, 5),
                    targets: container.querySelectorAll(".profile-lens-target").length,
                    tableRows: container.querySelectorAll(".profile-lens-table tbody tr").length,
                    tableHidden: srTable?.hasAttribute("hidden") ?? true,
                    srWidth: srRect ? Math.round(srRect.width) : -1,
                    srHeight: srRect ? Math.round(srRect.height) : -1,
                    svgWidth: Number(container.querySelector("svg")?.getAttribute("width") ?? 0),
                    svgHeight: Number(container.querySelector("svg")?.getAttribute("height") ?? 0)
                };
            });
            expect(overflow.problems, `overflow at ${size.width}x${size.height}`).toEqual([]);
            expect(overflow.targets, `targets at ${size.width}x${size.height}`).toBe(5 * 3 * 2);
            expect(overflow.tableRows, `table rows at ${size.width}x${size.height}`).toBe(5);
            expect(overflow.tableHidden, `table hidden at ${size.width}x${size.height}`).toBe(false);
            expect(overflow.srWidth).toBeLessThanOrEqual(2);
            expect(overflow.srHeight).toBeLessThanOrEqual(2);
            expect(overflow.svgWidth).toBeLessThanOrEqual(size.width);
            expect(overflow.svgHeight).toBeLessThanOrEqual(size.height);
        }
    });

    test("moves keyboard focus across profile targets and restores it after a rerender", async ({ page }) => {
        await mount(page);
        const first = page.locator('.profile-lens-target[tabindex="0"]').first();
        await first.focus();
        const firstKey = await first.getAttribute("data-key");

        await page.keyboard.press("ArrowRight");
        const focusedKey = await page.evaluate(() =>
            document.activeElement?.getAttribute("data-key") ?? null);
        expect(focusedKey).not.toBeNull();
        expect(focusedKey).not.toBe(firstKey);

        await page.evaluate(() => (window as unknown as {
            resizeProfileLens: (width: number, height: number) => boolean;
        }).resizeProfileLens(900, 500));

        const restored = await page.evaluate(() =>
            document.activeElement?.getAttribute("data-key") ?? null);
        expect(restored).toBe(focusedKey);

        await page.keyboard.press("Escape");
        const afterEscape = await page.evaluate(() =>
            document.activeElement?.className ?? "");
        expect(String(afterEscape)).toContain("profile-lens");
    });

    test("removes disabled controls from keyboard navigation and exposes ARIA state", async ({ page }) => {
        await mount(page, { allowInteractions: false });
        const targets = page.locator(".profile-lens-target");
        await expect(targets.first()).toHaveAttribute("role", "button");
        await expect(targets.first()).toHaveAttribute("aria-disabled", "true");
        await expect(targets.locator('[tabindex="0"]')).toHaveCount(0);
        await expect(page.locator('.profile-lens-entity-option[tabindex="0"]')).toHaveCount(0);
        await expect(page.locator(".profile-lens-period-slider")).toHaveAttribute("tabindex", "-1");

        await targets.first().dispatchEvent("keydown", { key: "Enter" });
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: Record<string, number> };
        }).profileLensHost.calls);
        expect(calls.select).toBe(0);
    });

    test("redirects pointer focus away from disabled chart targets", async ({ page }) => {
        await mount(page, { allowInteractions: false });
        const targets = page.locator(".profile-lens-target");

        await targets.nth(1).click({ force: true });

        await expect(targets.locator('[tabindex="0"]')).toHaveCount(0);
        const activeClass = await page.evaluate(() =>
            document.activeElement?.getAttribute("class") ?? "");
        expect(activeClass).toBe("profile-lens");
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: Record<string, number> };
        }).profileLensHost.calls);
        expect(calls.select).toBe(0);
    });

    test("redirects physical pointer focus away from disabled entity and period controls", async ({ page }) => {
        await mount(page, {
            allowInteractions: false,
            entities: Array.from({ length: 100 }, (_unused, index) => `Entity ${index + 1}`)
        });
        const entity = page.locator('.profile-lens-entity-option[data-entity-index="1"]');
        const entityContainer = page.locator(".profile-lens-entities");
        const period = page.locator(".profile-lens-period-slider");

        await entity.click({ force: true });
        let activeClass = await page.evaluate(() =>
            document.activeElement?.getAttribute("class") ?? "");
        expect(activeClass).toBe("profile-lens");
        await expect(entity).toHaveAttribute("tabindex", "-1");

        const entityBounds = await entityContainer.boundingBox();
        expect(entityBounds).not.toBeNull();
        await page.mouse.click(
            (entityBounds?.x ?? 0) + (entityBounds?.width ?? 0) - 2,
            (entityBounds?.y ?? 0) + (entityBounds?.height ?? 0) / 2
        );
        activeClass = await page.evaluate(() =>
            document.activeElement?.getAttribute("class") ?? "");
        expect(activeClass).toBe("profile-lens");

        await period.click({ force: true });
        activeClass = await page.evaluate(() =>
            document.activeElement?.getAttribute("class") ?? "");
        expect(activeClass).toBe("profile-lens");
        await expect(period).toHaveAttribute("tabindex", "-1");
    });

    test("keeps every disabled interactive surface out of sequential keyboard focus", async ({ page }) => {
        await mount(page, {
            allowInteractions: false,
            entities: Array.from({ length: 100 }, (_unused, index) => `Entity ${index + 1}`)
        });
        const root = page.locator(".profile-lens");
        await root.focus();
        await page.keyboard.press("Tab");

        const activeClass = await page.evaluate(() =>
            document.activeElement?.getAttribute("class") ?? "");
        expect([
            "profile-lens-target",
            "profile-lens-entity-option",
            "profile-lens-entities",
            "profile-lens-period-slider"
        ]).not.toContain(activeClass);
    });

    test("uses the host high contrast colors", async ({ page }) => {
        await mount(page, { highContrast: true, contextMode: "grid" });
        const fills = await page.evaluate(() =>
            Array.from(document.querySelectorAll(".profile-lens-target rect"))
                .slice(0, 4)
                .map((node) => ({
                    fill: node.getAttribute("fill"),
                    stroke: node.getAttribute("stroke")
                })));
        expect(fills.length).toBeGreaterThan(0);
        for (const entry of fills) {
            expect(entry.stroke).toBe("#FFFFFF");
            expect(entry.fill === "#FFFFFF" || entry.fill?.startsWith("url(#")).toBe(true);
        }
        const contextFeature = page.locator(".profile-lens-context-svg [data-context-key]").first();
        await expect(contextFeature).toHaveAttribute("fill", "#000000");
        await expect(contextFeature).toHaveAttribute("stroke", "#00FF00");
        await expect(page.locator(".profile-lens-context-svg [data-context-key]").nth(1))
            .toHaveAttribute("stroke", "#FFFFFF");
        await expect(page.locator(".profile-lens-high-contrast")).toHaveCount(1);
    });

    test("runs the tooltip and context menu lifecycle exactly once per gesture", async ({ page }) => {
        await mount(page);
        const readCalls = () => page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: Record<string, number> };
        }).profileLensHost.calls);

        const target = page.locator(".profile-lens-target").first();
        await target.hover();
        expect(await readCalls()).toMatchObject({ tooltipShow: 1, tooltipHide: 0 });

        // Moving inside the same target must not restart the tooltip lifecycle.
        await target.hover({ position: { x: 2, y: 2 } });
        expect((await readCalls()).tooltipShow).toBe(1);

        await page.mouse.move(0, 0);
        expect((await readCalls()).tooltipHide).toBe(1);

        await target.click({ button: "right" });
        const afterMenu = await readCalls();
        expect(afterMenu.contextMenu).toBe(1);

        await page.locator(".profile-lens").click({ button: "right", position: { x: 2, y: 2 } });
        expect((await readCalls()).contextMenu).toBe(2);
    });

    test("makes no external network request and no recurring work after settling", async ({ page }) => {
        externalRequests.length = 0;
        await mount(page, {
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            entities: ["USA", "CAN", "MEX"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const mutations = await page.evaluate(async () => {
            const container = document.getElementById("visual-root") as HTMLElement;
            let count = 0;
            const observer = new MutationObserver((records) => {
                count += records.length;
            });

            observer.observe(container, { childList: true, subtree: true, attributes: true });
            await new Promise((done) => setTimeout(done, 1200));
            observer.disconnect();
            return count;
        });
        expect(mutations).toBe(0);
        expect(externalRequests).toEqual([]);
    });

    test("renders exact world and complete state-equivalent pack semantics", async ({ page }) => {
        await mount(page, {
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            entities: ["USA", "NE:KOS", " usa"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        await expect(page.locator(".profile-lens-context")).toHaveAttribute("aria-setsize", "2");
        await expect(page.locator(".profile-lens-context-attribution"))
            .toContainText("Made with Natural Earth");
        await expect(page.locator(".profile-lens-context-semantic [role='option']").first())
            .toHaveAttribute("aria-label", /United States of America, cartographic key USA/);
        await expect(page.locator('[data-code="malformedPackKey"]')).toContainText(" usa");

        await mount(page, {
            contextMode: "builtInPack",
            contextPack: "usStates",
            entities: STATE_KEYS,
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        await expect(page.locator(".profile-lens-context")).toHaveAttribute("aria-setsize", "56");
        await expect(page.locator(".profile-lens-context-attribution"))
            .toContainText("U.S. Census Bureau");
        const pathsAreFinite = await page.locator(".profile-lens-context-svg path").evaluateAll(
            (paths) => paths.every((path) => {
                const data = path.getAttribute("d") ?? "";
                return data.length > 0 && !/NaN|Infinity/.test(data);
            })
        );
        expect(pathsAreFinite).toBe(true);
    });

    test("keeps optional world 50m within timing, parity, and small-tile gates", async ({ page }) => {
        const exercise = async (threshold: number): Promise<{
            renderer: "svg" | "canvas";
            names: string[];
            elapsed: number;
        }> => {
            const started = Date.now();
            await mount(page, {
                contextMode: "builtInPack",
                contextPack: "worldCountries",
                worldDetail: "50m",
                svgFeatureThreshold: threshold,
                entities: WORLD_50_KEYS,
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            const elapsed = Date.now() - started;
            const renderer = await page.locator(".profile-lens-context-canvas").evaluate(
                (canvas) => (canvas as HTMLCanvasElement).width > 1 ? "canvas" : "svg"
            );
            const names = await page.locator(
                ".profile-lens-context-semantic [role='option']"
            ).evaluateAll((options) => options.map((entry) => entry.getAttribute("aria-label") ?? ""));
            await page.evaluate(() => (window as unknown as {
                resizeProfileLens: (width: number, height: number) => boolean;
            }).resizeProfileLens(80, 80));
            const bounded = await page.locator(".profile-lens-context").evaluate((node) => {
                const root = document.getElementById("visual-root")!.getBoundingClientRect();
                const bounds = node.getBoundingClientRect();
                return bounds.left >= root.left - 1
                    && bounds.top >= root.top - 1
                    && bounds.right <= root.right + 1
                    && bounds.bottom <= root.bottom + 1;
            });
            expect(bounded).toBe(true);
            return { renderer, names, elapsed };
        };

        const svg = await exercise(500);
        const canvas = await exercise(1);
        expect(svg.renderer).toBe("svg");
        expect(canvas.renderer).toBe("canvas");
        expect(canvas.names).toEqual(svg.names);
        expect(svg.elapsed).toBeLessThan(750);
        expect(canvas.elapsed).toBeLessThan(750);
    });

    test("keeps adversarial boundaries, holes, and overlaps in SVG/Canvas parity", async ({ page }) => {
        const geometries = [
            "POLYGON ((0 0,10 0,10 10,0 10,0 0))",
            "POLYGON ((10 0,20 0,20 10,10 10,10 0))",
            "POLYGON ((2 2,8 2,8 8,2 8,2 2),(4 4,6 4,6 6,4 6,4 4))",
            "POLYGON ((7 2,12 2,12 8,7 8,7 2))"
        ];
        const points = [
            { x: 9.9, y: 9, name: "under adjacent stroke" },
            { x: 5, y: 5, name: "inside overlay hole" },
            { x: 8, y: 5, name: "inside later overlap" },
            { x: 15, y: 5, name: "inside adjacent polygon" },
            { x: 10, y: 9, name: "on shared edge" }
        ];
        const exercise = async (
            svgFeatureThreshold: number,
            width: number,
            height: number,
            devicePixelRatio: number
        ): Promise<string[]> => {
            await mount(page, {
                contextMode: "boundGeometry",
                svgFeatureThreshold,
                entities: ["Base", "Adjacent", "Holed", "Overlap"],
                geometryTexts: geometries,
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"],
                width,
                height,
                devicePixelRatio
            });
            return page.locator(".profile-lens-context").evaluate((node, testPoints) => {
                const root = node as HTMLElement;
                const bounds = root.getBoundingClientRect();
                const innerWidth = Math.max(bounds.width - 16, 1);
                const innerHeight = Math.max(bounds.height - 16, 1);
                const scale = Math.min(innerWidth / 20, innerHeight / 10);
                const translateX = 8 + (innerWidth - 20 * scale) / 2;
                const translateY = 8 + (innerHeight - 10 * scale) / 2 + 10 * scale;
                const keys: string[] = [];
                for (const point of testPoints) {
                    const clientX = bounds.left + point.x * scale + translateX;
                    const clientY = bounds.top + translateY - point.y * scale;
                    root.dispatchEvent(new PointerEvent("pointermove", {
                        bubbles: true,
                        clientX,
                        clientY,
                        pointerType: "mouse"
                    }));
                    keys.push((window as unknown as {
                        profileLensHost: { calls: { lastTooltipKey: string } };
                    }).profileLensHost.calls.lastTooltipKey);
                    root.dispatchEvent(new PointerEvent("pointerout", {
                        bubbles: true,
                        clientX,
                        clientY,
                        pointerType: "mouse"
                    }));
                }
                return keys;
            }, points);
        };

        const svg = await exercise(500, 1280, 620, 1);
        expect(svg.slice(0, 4)).toEqual([
            "|node:entity:0",
            "|node:entity:0",
            "|node:entity:3",
            "|node:entity:1"
        ]);
        for (const value of [
            { threshold: 1, width: 1280, height: 620, dpr: 1 },
            { threshold: 1, width: 1280, height: 620, dpr: 2 },
            { threshold: 1, width: 10000, height: 2000, dpr: 2 }
        ]) {
            const canvas = await exercise(value.threshold, value.width, value.height, value.dpr);
            expect(canvas, `Canvas parity at DPR ${value.dpr}, width ${value.width}`).toEqual(svg);
        }
    });

    test("keeps SVG and Canvas context semantics and host identities identical", async ({ page }) => {
        const exercise = async (threshold: number): Promise<{
            selected: string | null;
            tooltip: string | null;
            context: string | null;
            renderer: string;
        }> => {
            await mount(page, {
                contextMode: "grid",
                svgFeatureThreshold: threshold,
                entities: ["Entity A", "Entity B", "Entity C"],
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            const surface = page.locator(".profile-lens-context");
            const bounds = await surface.boundingBox();
            expect(bounds).not.toBeNull();
            const x = (bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.25;
            const y = (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.25;
            await page.mouse.move(x, y);
            await page.mouse.click(x, y);
            await page.mouse.click(x, y, { button: "right" });
            const calls = await page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: Record<string, number | string | null> };
            }).profileLensHost.calls);
            const canvasWidth = await page.locator(".profile-lens-context-canvas")
                .evaluate((canvas) => (canvas as HTMLCanvasElement).width);
            return {
                selected: calls.lastSelectedKey as string | null,
                tooltip: calls.lastTooltipKey as string | null,
                context: calls.lastContextKey as string | null,
                renderer: canvasWidth > 1 ? "canvas" : "svg"
            };
        };

        const svg = await exercise(500);
        const canvas = await exercise(1);
        expect(svg.renderer).toBe("svg");
        expect(canvas.renderer).toBe("canvas");
        expect(canvas.selected).toBe(svg.selected);
        expect(canvas.tooltip).toBe(svg.tooltip);
        expect(canvas.context).toBe(svg.context);
        expect(svg.selected).toContain("entity:0");
    });

    test("supports only local focus and report selection without outward filters", async ({ page }) => {
        const activate = async (interactionMode: "localOnly" | "reportSelection"): Promise<{
            filter: number;
            select: number;
        }> => {
            await mount(page, {
                contextMode: "grid",
                interactionMode,
                entities: ["Entity A", "Entity B"],
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            const surface = page.locator(".profile-lens-context");
            const bounds = await surface.boundingBox();
            await page.mouse.click(
                (bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.75,
                (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.5
            );
            await expect(page.locator(".profile-lens-header-title")).toHaveText("Entity B");
            return page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: { filter: number; select: number } };
            }).profileLensHost.calls);
        };

        expect(await activate("localOnly")).toMatchObject({ filter: 0, select: 0 });
        expect(await activate("reportSelection")).toMatchObject({ filter: 0, select: 1 });
    });

    test("bounds Canvas and redirects disabled physical context focus", async ({ page }) => {
        const started = Date.now();
        await mount(page, {
            contextMode: "builtInPack",
            contextPack: "usCounties",
            svgFeatureThreshold: 1,
            allowInteractions: false,
            entities: COUNTY_KEYS,
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"],
            width: 1280,
            height: 620
        });
        expect(Date.now() - started).toBeLessThan(750);
        const canvas = page.locator(".profile-lens-context-canvas");
        const allocation = await canvas.evaluate((node) => ({
            width: (node as HTMLCanvasElement).width,
            height: (node as HTMLCanvasElement).height
        }));
        expect(allocation.width).toBeLessThanOrEqual(4096);
        expect(allocation.height).toBeLessThanOrEqual(4096);
        expect(allocation.width * allocation.height).toBeLessThanOrEqual(8_388_608);

        const surface = page.locator(".profile-lens-context");
        await expect(surface).toHaveAttribute("tabindex", "-1");
        const bounds = await surface.boundingBox();
        await page.mouse.click(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.25,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.25
        );
        const activeClass = await page.evaluate(() =>
            document.activeElement?.getAttribute("class") ?? "");
        expect(activeClass).toBe("profile-lens");
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: Record<string, number> };
        }).profileLensHost.calls);
        expect(calls.select).toBe(0);
        expect(calls.tooltipShow).toBe(0);
        expect(calls.contextMenu).toBe(0);
        expect(calls.filter).toBe(0);
        await expect(page.locator(".profile-lens-context-semantic [role='option']")).toHaveCount(100);
    });

    test("bounds full-county Canvas picking candidates at DPR and scaled backing", async ({ page }) => {
        const cases = [
            { width: 1280, height: 620, devicePixelRatio: 1, scaled: false },
            { width: 1280, height: 620, devicePixelRatio: 2, scaled: false },
            { width: 10000, height: 2000, devicePixelRatio: 2, scaled: true }
        ];
        const observed: Array<PickingMetrics & {
            readonly width: number;
            readonly height: number;
            readonly devicePixelRatio: number;
        }> = [];
        for (const value of cases) {
            const mountStarted = Date.now();
            await mount(page, {
                contextMode: "builtInPack",
                contextPack: "usCounties",
                entities: COUNTY_KEYS,
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"],
                width: value.width,
                height: value.height,
                devicePixelRatio: value.devicePixelRatio
            });
            const mountElapsed = Date.now() - mountStarted;
            const interaction = await page.locator(".profile-lens-context").evaluate((node) => {
                type Metrics = {
                    sceneFeatures: number;
                    pickingReads: number;
                    candidateValidations: number;
                    targetMapLookups: number;
                    targetMapMisses: number;
                    resolvedHits: number;
                    pickedCandidatesDecoded: number;
                    localizedQueries: number;
                    localizedCandidateValidations: number;
                    maxLocalizedCandidatesExamined: number;
                    spatialBucketEntries: number;
                    spatialGlobalCandidates: number;
                    maxBucketOccupancy: number;
                    maxBucketsPerFeature: number;
                    pickingScaleX: number;
                    pickingScaleY: number;
                };
                const root = node as HTMLElement & { __profileLensCanvasHitMetrics: Metrics };
                const before = { ...root.__profileLensCanvasHitMetrics };
                const bounds = root.getBoundingClientRect();
                const started = performance.now();
                const moves = 50;
                for (let index = 0; index < moves; index += 1) {
                    root.dispatchEvent(new PointerEvent("pointermove", {
                        bubbles: true,
                        clientX: bounds.left + 1 + ((index * 97) % Math.max(bounds.width - 2, 1)),
                        clientY: bounds.top + 1 + ((index * 53) % Math.max(bounds.height - 2, 1)),
                        pointerType: "mouse"
                    }));
                }
                const elapsed = performance.now() - started;
                const after = root.__profileLensCanvasHitMetrics;
                return {
                    elapsed,
                    moves,
                    sceneFeatures: after.sceneFeatures,
                    pickingReads: after.pickingReads - before.pickingReads,
                    candidateValidations:
                        after.candidateValidations - before.candidateValidations,
                    targetMapLookups: after.targetMapLookups - before.targetMapLookups,
                    targetMapMisses: after.targetMapMisses - before.targetMapMisses,
                    resolvedHits: after.resolvedHits - before.resolvedHits,
                    pickedCandidatesDecoded:
                        after.pickedCandidatesDecoded - before.pickedCandidatesDecoded,
                    localizedQueries: after.localizedQueries - before.localizedQueries,
                    localizedCandidateValidations:
                        after.localizedCandidateValidations
                        - before.localizedCandidateValidations,
                    maxLocalizedCandidatesExamined: after.maxLocalizedCandidatesExamined,
                    spatialBucketEntries: after.spatialBucketEntries,
                    spatialGlobalCandidates: after.spatialGlobalCandidates,
                    maxBucketOccupancy: after.maxBucketOccupancy,
                    maxBucketsPerFeature: after.maxBucketsPerFeature,
                    scaled: after.pickingScaleX < 1 || after.pickingScaleY < 1
                };
            });
            const result = { ...interaction, mountElapsed };
            expect(result.sceneFeatures).toBe(3235);
            assertCoherentPickingMetrics(result);
            expect(result.targetMapLookups).toBeGreaterThan(0);
            expect(result.scaled).toBe(value.scaled);
            expect(result.elapsed).toBeLessThan(250);
            expect(result.mountElapsed).toBeLessThan(750);
            observed.push({ ...value, ...result });
        }
        expect(() => assertCoherentPickingMetrics({
            ...observed[0],
            targetMapLookups: 0
        })).toThrow(/targetMapLookups/);
        expect(() => assertCoherentPickingMetrics({
            ...observed[0],
            pickingReads: 0
        })).toThrow(/pickingReads/);
        console.log(`Full-county picking metrics: ${JSON.stringify(observed)}`);
    });

    test("bounds the semantic entity list while preserving host order", async ({ page }) => {
        await mount(page, {
            contextMode: "hex",
            entities: Array.from({ length: 150 }, (_unused, index) => `Entity ${index + 1}`),
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const options = page.locator(".profile-lens-context-semantic [role='option']");
        await expect(options).toHaveCount(100);
        await expect(options.first()).toHaveAttribute("aria-label", /Entity 1, hex cell/);
        await expect(options.last()).toHaveAttribute("aria-label", /Entity 100, hex cell/);
        await expect(options.last()).toHaveAttribute("aria-setsize", "150");
    });

    test("keeps every context layout bounded through 80x80", async ({ page }) => {
        for (const contextLayout of ["split", "focusLens", "locatorInset", "profileOnly"]) {
            await mount(page, {
                contextMode: "grid",
                contextLayout,
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            for (const size of SIZES) {
                await page.evaluate(
                    (viewport) => (window as unknown as {
                        resizeProfileLens: (width: number, height: number) => boolean;
                    }).resizeProfileLens(viewport.width, viewport.height),
                    size
                );
                const overflow = await page.evaluate(() => {
                    const root = document.getElementById("visual-root")!.getBoundingClientRect();
                    const nodes = [
                        document.querySelector(".profile-lens-context"),
                        document.querySelector(".profile-lens-profile-svg")
                    ].filter(Boolean) as Element[];
                    return nodes
                        .filter((node) => !(node as HTMLElement).hasAttribute("hidden"))
                        .map((node) => node.getBoundingClientRect())
                        .some((rect) =>
                            rect.left < root.left - 1
                            || rect.top < root.top - 1
                            || rect.right > root.right + 1
                            || rect.bottom > root.bottom + 1);
                });
                expect(overflow, `${contextLayout} at ${size.width}x${size.height}`).toBe(false);
                if (size.width === 80 && size.height === 80) {
                    await expect(page.locator(".profile-lens-context")).toBeHidden();
                }
            }
        }
    });
});
