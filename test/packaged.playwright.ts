import { expect, test, Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const probeDirectory = resolve(root, ".tmp", "probe");
const bundlePath = resolve(probeDirectory, "visual.js");
const stylePath = resolve(probeDirectory, "visual.css");
const metaPath = resolve(probeDirectory, "bundle-meta.json");
const harnessPath = resolve(__dirname, "probe-harness", "harness.js");
const resourcesPath = resolve(root, "stringResources", "en-US", "resources.resjson");

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
        await mount(page);
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

    test("bounds Canvas and redirects disabled physical context focus", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            svgFeatureThreshold: 1,
            allowInteractions: false,
            entities: Array.from({ length: 600 }, (_unused, index) => `Entity ${index + 1}`),
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"],
            width: 1280,
            height: 620
        });
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
    });

    test("preserves report-filter context focus until fresh host filters reconcile it", async ({ page }) => {
        const assertEntity = async (label: string, activeDescendant: string): Promise<void> => {
            await expect(page.locator(".profile-lens-header-title")).toHaveText(label);
            await expect(page.locator(".profile-lens-context"))
                .toHaveAttribute("aria-activedescendant", activeDescendant);
        };
        const options = {
            contextMode: "grid",
            interactionMode: "reportFilter",
            entities: ["Entity A", "Entity B"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        };
        await mount(page, options);
        const surface = page.locator(".profile-lens-context");
        const bounds = await surface.boundingBox();
        expect(bounds).not.toBeNull();
        await page.mouse.click(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.75,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.5
        );
        await assertEntity("Entity B", "context:entity:1");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { filter: number } };
        }).profileLensHost.calls.filter)).toBe(1);

        await page.evaluate(() => (window as unknown as {
            profileLensUpdate: (options: unknown) => void;
            profileLensDataView: unknown;
        }).profileLensUpdate({
            width: 1280,
            height: 620,
            dataViews: [(window as unknown as { profileLensDataView: unknown }).profileLensDataView],
            jsonFilters: [{
                target: { table: "Table", column: "Entity" },
                operator: "In",
                values: ["Entity B"],
                filterType: 1
            }]
        }));
        await assertEntity("Entity B", "context:entity:1");

        await page.evaluate(() => (window as unknown as {
            profileLensUpdate: (options: unknown) => void;
            profileLensDataView: unknown;
        }).profileLensUpdate({
            width: 1280,
            height: 620,
            dataViews: [(window as unknown as { profileLensDataView: unknown }).profileLensDataView],
            jsonFilters: []
        }));
        await assertEntity("Entity A", "context:entity:0");

        await mount(page, options);
        const keyboardSurface = page.locator(".profile-lens-context");
        await keyboardSurface.focus();
        await page.keyboard.press("ArrowRight");
        await assertEntity("Entity B", "context:entity:1");
        await expect(keyboardSurface).toBeFocused();
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { filter: number } };
        }).profileLensHost.calls.filter)).toBe(0);
        await page.keyboard.press("Enter");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { filter: number } };
        }).profileLensHost.calls.filter)).toBe(1);
    });

    test("reconciles report-filter mode re-entry without fresh host filters", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            interactionMode: "reportFilter",
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
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { filter: number } };
        }).profileLensHost.calls.filter)).toBe(1);

        await page.evaluate(() => {
            const runtime = window as unknown as {
                profileLensUpdate: (options: unknown) => void;
                profileLensDataView: unknown;
            };
            runtime.profileLensUpdate({
                width: 1280,
                height: 620,
                dataViews: [runtime.profileLensDataView],
                jsonFilters: [{
                    target: { table: "Table", column: "Entity" },
                    operator: "In",
                    values: ["Entity B"],
                    filterType: 1
                }]
            });
        });
        await expect(page.locator(".profile-lens-header-title")).toHaveText("Entity B");

        await page.evaluate(() => {
            const runtime = window as unknown as {
                profileLensUpdate: (options: unknown) => void;
                profileLensDataView: {
                    metadata: { objects: { interaction: { mode: string } } };
                };
            };
            runtime.profileLensDataView.metadata.objects.interaction.mode = "localOnly";
            runtime.profileLensUpdate({
                width: 1280,
                height: 620,
                dataViews: [runtime.profileLensDataView]
            });
        });
        await expect(page.locator(".profile-lens-header-title")).toHaveText("Entity B");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { filter: number } };
        }).profileLensHost.calls.filter)).toBe(2);

        await page.evaluate(() => {
            const runtime = window as unknown as {
                profileLensUpdate: (options: unknown) => void;
                profileLensDataView: {
                    metadata: { objects: { interaction: { mode: string } } };
                };
            };
            runtime.profileLensDataView.metadata.objects.interaction.mode = "reportFilter";
            runtime.profileLensUpdate({
                width: 1280,
                height: 620,
                dataViews: [runtime.profileLensDataView]
            });
        });
        await expect(page.locator(".profile-lens-header-title")).toHaveText("Entity A");
        await expect(surface).toHaveAttribute("aria-activedescendant", "context:entity:0");

        await page.mouse.click(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.75,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.5
        );
        await expect(page.locator(".profile-lens-header-title")).toHaveText("Entity B");
        await expect(surface).toHaveAttribute("aria-activedescendant", "context:entity:1");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { filter: number } };
        }).profileLensHost.calls.filter)).toBe(3);
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
