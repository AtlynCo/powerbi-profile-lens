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
    readonly normalBucketChecks: number;
    readonly normalCandidateValidationAttempts: number;
    readonly normalPickingSuccesses: number;
    readonly fallbackQueries: number;
    readonly fallbackCandidateReferencesRead: number;
    readonly fallbackCandidateValidations: number;
    readonly maxFallbackCandidatesExamined: number;
    readonly spatialBucketEntries: number;
    readonly maxBucketOccupancy: number;
    readonly spatialReferenceBudget: number;
    readonly bucketSize: number;
    readonly scaled: boolean;
    readonly displayBackingWidth: number;
    readonly displayBackingHeight: number;
    readonly baseRasterBackingWidth: number;
    readonly baseRasterBackingHeight: number;
    readonly pickingBackingWidth: number;
    readonly pickingBackingHeight: number;
    readonly totalBackingPixels: number;
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
    if (metrics.normalPickingSuccesses + metrics.fallbackQueries !== metrics.pickingReads) {
        throw new Error("every picking read must resolve normally or run one fallback query");
    }
    if (metrics.normalBucketChecks !== metrics.pickingReads) {
        throw new Error("normal O(1) bucket checks must equal picking reads");
    }
    if (
        metrics.normalCandidateValidationAttempts + metrics.fallbackCandidateValidations
        !== metrics.candidateValidations
    ) {
        throw new Error("candidate validation counters must describe real operations");
    }
    if (metrics.normalPickingSuccesses > metrics.normalCandidateValidationAttempts) {
        throw new Error("normal successes exceed actual validation attempts");
    }
    if (metrics.maxFallbackCandidatesExamined > metrics.sceneFeatures) {
        throw new Error("fallback exceeded the declared scene feature budget");
    }
    if (metrics.fallbackCandidateValidations > metrics.fallbackCandidateReferencesRead) {
        throw new Error("fallback validated more candidates than the index returned");
    }
    if (metrics.spatialBucketEntries > metrics.spatialReferenceBudget) {
        throw new Error("spatial index exceeded its explicit reference budget");
    }
    if (metrics.maxBucketOccupancy > metrics.sceneFeatures) {
        throw new Error("spatial bucket contains more references than scene features");
    }
    if (metrics.bucketSize < 32) {
        throw new Error("adaptive bucket size fell below its minimum");
    }
    for (const dimension of [
        metrics.displayBackingWidth,
        metrics.displayBackingHeight,
        metrics.baseRasterBackingWidth,
        metrics.baseRasterBackingHeight,
        metrics.pickingBackingWidth,
        metrics.pickingBackingHeight
    ]) {
        if (dimension > 4096) {
            throw new Error("a Canvas backing dimension exceeded 4096");
        }
    }
    if (metrics.totalBackingPixels > 8_388_608 * 3) {
        throw new Error("combined display, base, and picking backing pixels exceeded the budget");
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

    test("uses dark and light host high contrast colors for navigation chrome", async ({ page }) => {
        const cases = [
            {
                name: "dark",
                foreground: "#FFFFFF",
                background: "#000000",
                selected: "#00FF00",
                foregroundRgb: "rgb(255, 255, 255)",
                backgroundRgb: "rgb(0, 0, 0)",
                selectedRgb: "rgb(0, 255, 0)"
            },
            {
                name: "light",
                foreground: "#000000",
                background: "#FFFFFF",
                selected: "#0000FF",
                foregroundRgb: "rgb(0, 0, 0)",
                backgroundRgb: "rgb(255, 255, 255)",
                selectedRgb: "rgb(0, 0, 255)"
            }
        ];
        for (const value of cases) {
            const options = {
                highContrast: true,
                highContrastForeground: value.foreground,
                highContrastBackground: value.background,
                highContrastSelected: value.selected,
                contextMode: "grid",
                navigationEnabled: true
            };
            await mount(page, options);
            const fills = await page.evaluate(() =>
                Array.from(document.querySelectorAll(".profile-lens-target rect"))
                    .slice(0, 4)
                    .map((node) => ({
                        fill: node.getAttribute("fill"),
                        stroke: node.getAttribute("stroke")
                    })));
            expect(fills.length, value.name).toBeGreaterThan(0);
            for (const entry of fills) {
                expect(entry.stroke, value.name).toBe(value.foreground);
                expect(
                    entry.fill === value.foreground || entry.fill?.startsWith("url(#"),
                    value.name
                ).toBe(true);
            }
            const contextFeature = page.locator(
                ".profile-lens-context-svg [data-context-key]"
            ).first();
            await expect(contextFeature).toHaveAttribute("fill", value.background);
            await expect(contextFeature).toHaveAttribute("stroke", value.foreground);
            await expect(page.locator(".profile-lens-context-outline").first())
                .toHaveAttribute("stroke", value.selected);
            await expect(page.locator(".profile-lens-context-probe circle").nth(1))
                .toHaveAttribute("stroke", value.selected);
            await expect(page.locator(".profile-lens-context-probe circle").first())
                .toHaveAttribute("fill", value.background);

            const surface = page.locator(".profile-lens-context");
            const reset = page.locator(".profile-lens-context-reset");
            const help = page.locator(".profile-lens-context-help");
            await expect(help).toBeVisible();
            const computed = await page.evaluate(() => {
                const root = document.querySelector<HTMLElement>(".profile-lens")!;
                const surface = document.querySelector<HTMLElement>(".profile-lens-context")!;
                const reset = document.querySelector<HTMLButtonElement>(
                    ".profile-lens-context-reset"
                )!;
                const help = document.querySelector<HTMLElement>(".profile-lens-context-help")!;
                const attribution = document.querySelector<HTMLElement>(
                    ".profile-lens-context-attribution"
                )!;
                reset.focus();
                const resetStyle = getComputedStyle(reset);
                const resetFocusOutline = resetStyle.outlineColor;
                surface.focus();
                return {
                    variables: {
                        foreground: root.style.getPropertyValue("--profile-lens-foreground"),
                        background: root.style.getPropertyValue("--profile-lens-background"),
                        selected: root.style.getPropertyValue("--profile-lens-selected")
                    },
                    surface: {
                        color: getComputedStyle(surface).color,
                        background: getComputedStyle(surface).backgroundColor,
                        outline: getComputedStyle(surface).outlineColor
                    },
                    reset: {
                        color: resetStyle.color,
                        background: resetStyle.backgroundColor,
                        border: resetStyle.borderColor,
                        focusOutline: resetFocusOutline
                    },
                    help: {
                        color: getComputedStyle(help).color,
                        background: getComputedStyle(help).backgroundColor
                    },
                    attribution: {
                        color: getComputedStyle(attribution).color,
                        background: getComputedStyle(attribution).backgroundColor
                    }
                };
            });
            expect(computed.variables).toEqual({
                foreground: value.foreground,
                background: value.background,
                selected: value.selected
            });
            expect(computed.surface).toEqual({
                color: value.foregroundRgb,
                background: value.backgroundRgb,
                outline: value.foregroundRgb
            });
            expect(computed.reset).toEqual({
                color: value.foregroundRgb,
                background: value.backgroundRgb,
                border: value.foregroundRgb,
                focusOutline: value.selectedRgb
            });
            expect(computed.help).toEqual({
                color: value.foregroundRgb,
                background: value.backgroundRgb
            });
            expect(computed.attribution).toEqual({
                color: value.foregroundRgb,
                background: value.backgroundRgb
            });
            await expect(surface).toBeFocused();
            await expect(reset).toHaveAttribute("tabindex", "-1");

            await mount(page, { ...options, allowInteractions: false });
            const disabled = page.locator(".profile-lens-context-reset");
            await expect(disabled).toBeHidden();
            await expect(disabled).toBeDisabled();
            const disabledStyle = await disabled.evaluate((node) => {
                const style = getComputedStyle(node);
                return {
                    color: style.color,
                    background: style.backgroundColor,
                    border: style.borderColor,
                    borderStyle: style.borderStyle,
                    opacity: style.opacity
                };
            });
            expect(disabledStyle).toEqual({
                color: value.foregroundRgb,
                background: value.backgroundRgb,
                border: value.foregroundRgb,
                borderStyle: "dashed",
                opacity: "1"
            });
            await expect(page.locator(".profile-lens-context")).toHaveAttribute("tabindex", "-1");
            await expect(page.locator(".profile-lens-context"))
                .not.toHaveClass(/profile-lens-context-navigation-active/);
        }
    });

    test("keeps high contrast navigation chrome bounded in a small tile", async ({ page }) => {
        await mount(page, {
            highContrast: true,
            highContrastForeground: "#FFFFFF",
            highContrastBackground: "#000000",
            highContrastSelected: "#00FF00",
            contextMode: "grid",
            contextLayout: "locatorInset",
            navigationEnabled: true,
            width: 398,
            height: 298
        });
        const surface = page.locator(".profile-lens-context");
        await expect(surface).toBeVisible();
        await expect(page.locator(".profile-lens-context-help")).toBeHidden();
        const reset = page.locator(".profile-lens-context-reset");
        await expect(reset).toBeVisible();
        const bounded = await reset.evaluate((node) => {
            const control = node.getBoundingClientRect();
            const surface = node.parentElement!.getBoundingClientRect();
            return control.left >= surface.left
                && control.top >= surface.top
                && control.right <= surface.right
                && control.bottom <= surface.bottom;
        });
        expect(bounded).toBe(true);
        await expect(page.locator(".profile-lens-context-probe")).toHaveCount(1);
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

    test("contains physical wheel input at clamped min/max zoom with one settle", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: true,
            minZoom: 7.3,
            maxZoom: 7.3,
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const surface = page.locator(".profile-lens-context");
        const before = await surface.evaluate((node) => {
            const root = node as HTMLElement & {
                __profileLensContextMetrics: { cameraFrames: number; moveEnds: number };
            };
            const container = document.getElementById("visual-root")!;
            container.style.position = "fixed";
            container.style.inset = "0 auto auto 0";
            document.body.style.height = "3000px";
            window.scrollTo(0, 200);
            const state = {
                defaults: [] as boolean[],
                bubbled: 0,
                windowScroll: window.scrollY,
                rootScroll: root.scrollTop
            };
            root.addEventListener("wheel", (event) => {
                state.defaults.push(event.defaultPrevented);
            });
            document.body.addEventListener("wheel", () => {
                state.bubbled++;
            });
            (window as unknown as { __wheelContainment: typeof state }).__wheelContainment = state;
            return {
                cameraFrames: root.__profileLensContextMetrics.cameraFrames,
                moveEnds: root.__profileLensContextMetrics.moveEnds
            };
        });
        const bounds = await surface.boundingBox();
        expect(bounds).not.toBeNull();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        await page.mouse.wheel(0, 120);
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(150);
        const result = await surface.evaluate((node) => {
            const root = node as HTMLElement & {
                __profileLensContextMetrics: { cameraFrames: number; moveEnds: number };
            };
            const zero = new WheelEvent("wheel", {
                bubbles: true,
                cancelable: true,
                deltaY: 0,
                deltaMode: 0,
                clientX: 10,
                clientY: 10
            });
            const invalid = new WheelEvent("wheel", {
                bubbles: true,
                cancelable: true,
                deltaY: 0,
                deltaMode: 0,
                clientX: 10,
                clientY: 10
            });
            Object.defineProperty(invalid, "deltaY", { value: Number.NaN });
            root.dispatchEvent(zero);
            root.dispatchEvent(invalid);
            const state = (window as unknown as {
                __wheelContainment: {
                    defaults: boolean[];
                    bubbled: number;
                    windowScroll: number;
                    rootScroll: number;
                };
            }).__wheelContainment;
            return {
                cameraFrames: root.__profileLensContextMetrics.cameraFrames,
                moveEnds: root.__profileLensContextMetrics.moveEnds,
                defaults: state.defaults,
                bubbled: state.bubbled,
                windowScrollBefore: state.windowScroll,
                windowScrollAfter: window.scrollY,
                rootScrollBefore: state.rootScroll,
                rootScrollAfter: root.scrollTop,
                zeroPrevented: zero.defaultPrevented,
                invalidPrevented: invalid.defaultPrevented
            };
        });
        expect(result.cameraFrames).toBe(before.cameraFrames);
        expect(result.moveEnds - before.moveEnds).toBe(1);
        expect(result.defaults).toEqual([true, true, false, false]);
        expect(result.bubbled).toBe(2);
        expect(result.windowScrollAfter).toBe(result.windowScrollBefore);
        expect(result.rootScrollAfter).toBe(result.rootScrollBefore);
        expect(result.zeroPrevented).toBe(false);
        expect(result.invalidPrevented).toBe(false);
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { select: number; filter: number } };
        }).profileLensHost.calls);
        expect(calls).toMatchObject({ select: 0, filter: 0 });
    });

    test("makes no external network request and no recurring work after settling", async ({ page }) => {
        externalRequests.length = 0;
        await mount(page, {
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            navigationEnabled: true,
            entities: ["USA", "CAN", "MEX"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const contextBounds = await page.locator(".profile-lens-context").boundingBox();
        await page.mouse.move(
            (contextBounds?.x ?? 0) + (contextBounds?.width ?? 0) / 2,
            (contextBounds?.y ?? 0) + (contextBounds?.height ?? 0) / 2
        );
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(200);
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

    test("retains valid features beneath more than 32 large overlapping holes", async ({ page }) => {
        const base = "POLYGON ((0 0,80 0,80 80,0 80,0 0))";
        const holed = "POLYGON ((0 0,80 0,80 80,0 80,0 0),"
            + "(30 30,50 30,50 50,30 50,30 30))";
        const geometries = [base, ...Array.from({ length: 160 }, () => holed)];
        const entities = geometries.map((_unused, index) => `Layer ${index}`);
        const exercise = async (
            threshold: number,
            width: number,
            height: number,
            devicePixelRatio: number
        ): Promise<{
            keys: string[];
            metrics: {
                fallbackCandidateValidations: number;
                maxFallbackCandidatesExamined: number;
                maxBucketOccupancy: number;
                spatialBucketEntries: number;
                spatialReferenceBudget: number;
            } | null;
        }> => {
            await mount(page, {
                contextMode: "boundGeometry",
                svgFeatureThreshold: threshold,
                entities,
                geometryTexts: geometries,
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"],
                width,
                height,
                devicePixelRatio
            });
            return page.locator(".profile-lens-context").evaluate((node) => {
                type Metrics = {
                    fallbackCandidateValidations: number;
                    maxFallbackCandidatesExamined: number;
                    maxBucketOccupancy: number;
                    spatialBucketEntries: number;
                    spatialReferenceBudget: number;
                };
                const root = node as HTMLElement & {
                    __profileLensCanvasHitMetrics?: Metrics | null;
                };
                const bounds = root.getBoundingClientRect();
                const innerWidth = Math.max(bounds.width - 16, 1);
                const innerHeight = Math.max(bounds.height - 16, 1);
                const scale = Math.min(innerWidth / 80, innerHeight / 80);
                const translateX = 8 + (innerWidth - 80 * scale) / 2;
                const translateY = 8 + (innerHeight - 80 * scale) / 2 + 80 * scale;
                const keys: string[] = [];
                for (const point of [{ x: 40, y: 40 }, { x: 20, y: 20 }]) {
                    root.dispatchEvent(new PointerEvent("pointermove", {
                        bubbles: true,
                        clientX: bounds.left + point.x * scale + translateX,
                        clientY: bounds.top + translateY - point.y * scale,
                        pointerType: "mouse"
                    }));
                    keys.push((window as unknown as {
                        profileLensHost: { calls: { lastTooltipKey: string } };
                    }).profileLensHost.calls.lastTooltipKey);
                }
                return {
                    keys,
                    metrics: root.__profileLensCanvasHitMetrics
                        ? { ...root.__profileLensCanvasHitMetrics }
                        : null
                };
            });
        };

        const svg = await exercise(500, 1280, 620, 1);
        expect(svg.keys).toEqual(["|node:entity:0", "|node:entity:160"]);
        const observed: unknown[] = [];
        for (const value of [
            { width: 1280, height: 620, dpr: 1 },
            { width: 1280, height: 620, dpr: 2 },
            { width: 10000, height: 2000, dpr: 2 }
        ]) {
            const canvas = await exercise(1, value.width, value.height, value.dpr);
            expect(canvas.keys).toEqual(svg.keys);
            expect(canvas.metrics).not.toBeNull();
            expect(canvas.metrics!.maxBucketOccupancy).toBe(161);
            expect(canvas.metrics!.maxFallbackCandidatesExamined).toBeGreaterThan(32);
            expect(canvas.metrics!.fallbackCandidateValidations).toBeGreaterThan(32);
            expect(canvas.metrics!.spatialBucketEntries)
                .toBeLessThanOrEqual(canvas.metrics!.spatialReferenceBudget);
            observed.push({ ...value, ...canvas.metrics });
        }
        console.log(`Adversarial overlap metrics: ${JSON.stringify(observed)}`);
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

    test("keeps transformed SVG and Canvas picking under physical camera gestures", async ({ page }) => {
        const exercise = async (threshold: number): Promise<{
            renderer: "svg" | "canvas";
            selected: string | null;
            tooltip: string | null;
            context: string | null;
        }> => {
            await mount(page, {
                contextMode: "grid",
                navigationEnabled: true,
                svgFeatureThreshold: threshold,
                entities: ["Entity A", "Entity B"],
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            const surface = page.locator(".profile-lens-context");
            const bounds = await surface.boundingBox();
            expect(bounds).not.toBeNull();
            await surface.evaluate((node) => {
                const root = node as HTMLElement & {
                    __captureCounts?: { got: number; lost: number };
                };
                root.__captureCounts = { got: 0, lost: 0 };
                root.addEventListener("gotpointercapture", () => {
                    root.__captureCounts!.got++;
                });
                root.addEventListener("lostpointercapture", () => {
                    root.__captureCounts!.lost++;
                });
            });
            const centerX = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
            const centerY = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
            await page.mouse.move(centerX, centerY);
            await page.mouse.down();
            await page.mouse.move(centerX - 24, centerY + 8, { steps: 8 });
            await page.mouse.up();
            expect(await surface.evaluate((node) =>
                (node as HTMLElement & {
                    __captureCounts?: { got: number; lost: number };
                }).__captureCounts)).toEqual({ got: 1, lost: 1 });
            await page.mouse.wheel(0, -180);
            await page.waitForTimeout(140);

            const target = await surface.evaluate((node) => {
                const root = node as HTMLElement;
                const bounds = root.getBoundingClientRect();
                const transform = root.querySelector(".profile-lens-context-outline-layer")
                    ?.getAttribute("transform");
                if (!transform) {
                    throw new Error("camera transform is missing");
                }
                const values = transform.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number);
                if (!values || values.length !== 6) {
                    throw new Error(`camera transform is invalid: ${transform}`);
                }
                const baseX = bounds.width * 0.75;
                const baseY = bounds.height * 0.5;
                return {
                    x: bounds.left + values[0] * baseX + values[4],
                    y: bounds.top + values[3] * baseY + values[5],
                    transform
                };
            });
            expect(target.transform).not.toBe("matrix(1,0,0,1,0,0)");
            await page.mouse.move(target.x, target.y);
            await page.mouse.click(target.x, target.y, { button: "right" });
            await page.mouse.click(target.x, target.y);
            const calls = await page.evaluate(() => (window as unknown as {
                profileLensHost: {
                    calls: {
                        select: number;
                        contextMenu: number;
                        lastSelectedKey: string | null;
                        lastTooltipKey: string | null;
                        lastContextKey: string | null;
                    };
                };
            }).profileLensHost.calls);
            expect(calls.select).toBe(1);
            expect(calls.contextMenu).toBe(1);
            expect(calls.lastSelectedKey).toContain("entity:1");
            expect(calls.lastTooltipKey).toContain("entity:1");
            expect(calls.lastContextKey).toContain("entity:1");
            await expect(page.locator(".profile-lens-context-outline")).not.toHaveCount(0);
            await expect(page.locator(".profile-lens-context-outline-layer"))
                .toHaveAttribute("transform", target.transform);
            await page.locator(".profile-lens-context-reset").click();
            await expect(page.locator(".profile-lens-context-outline-layer"))
                .toHaveAttribute("transform", "matrix(1,0,0,1,0,0)");
            expect(await page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: { select: number; contextMenu: number } };
            }).profileLensHost.calls)).toMatchObject({ select: 1, contextMenu: 1 });
            await expect(surface).toBeFocused();
            await surface.evaluate((node) => {
                const root = node as HTMLElement;
                const bounds = root.getBoundingClientRect();
                const fire = (type: string, x: number) => root.dispatchEvent(new PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerId: 81,
                    pointerType: "touch",
                    button: 0,
                    clientX: bounds.left + x,
                    clientY: bounds.top + bounds.height / 2
                }));
                fire("pointerdown", bounds.width / 2);
                fire("pointermove", bounds.width / 2 + 24);
                fire("pointerup", bounds.width / 2 + 24);
            });
            await expect(page.locator(".profile-lens-context-outline-layer"))
                .not.toHaveAttribute("transform", "matrix(1,0,0,1,0,0)");
            expect(await page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: { select: number; contextMenu: number } };
            }).profileLensHost.calls)).toMatchObject({ select: 1, contextMenu: 1 });
            const canvasWidth = await page.locator(".profile-lens-context-canvas")
                .evaluate((canvas) => (canvas as HTMLCanvasElement).width);
            return {
                renderer: canvasWidth > 1 ? "canvas" : "svg",
                selected: calls.lastSelectedKey,
                tooltip: calls.lastTooltipKey,
                context: calls.lastContextKey
            };
        };

        const svg = await exercise(500);
        const canvas = await exercise(1);
        expect(svg.renderer).toBe("svg");
        expect(canvas.renderer).toBe("canvas");
        expect(canvas.selected).toBe(svg.selected);
        expect(canvas.tooltip).toBe(svg.tooltip);
        expect(canvas.context).toBe(svg.context);
    });

    test("keeps snapshot pinch and two-to-one rebase transforms identical in SVG and Canvas", async ({ page }) => {
        const exercise = async (threshold: number) => {
            await mount(page, {
                contextMode: "grid",
                navigationEnabled: true,
                svgFeatureThreshold: threshold,
                entities: ["Entity A", "Entity B"],
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            const result = await page.locator(".profile-lens-context").evaluate((node) => {
                const root = node as HTMLElement & {
                    __profileLensContextMetrics: { cameraFrames: number; moveEnds: number };
                };
                const bounds = root.getBoundingClientRect();
                const fire = (type: string, id: number, x: number, y: number) => {
                    root.dispatchEvent(new PointerEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        pointerId: id,
                        pointerType: "touch",
                        button: 0,
                        clientX: bounds.left + x,
                        clientY: bounds.top + y
                    }));
                };
                const matrix = () => {
                    const transform = root.querySelector(".profile-lens-context-outline-layer")
                        ?.getAttribute("transform") ?? "";
                    const values = transform
                        .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)
                        ?.map(Number) ?? [];
                    if (values.length !== 6) throw new Error(`invalid pinch transform ${transform}`);
                    return values;
                };
                const before = { ...root.__profileLensContextMetrics };
                fire("pointerdown", 51, 90, 130);
                fire("pointerdown", 52, 210, 170);
                fire("pointermove", 51, 70, 120);
                fire("pointermove", 52, 250, 190);
                const pinched = matrix();
                fire("pointerup", 52, 250, 190);
                const afterLift = matrix();
                fire("pointermove", 51, 82, 126);
                const rebased = matrix();
                fire("pointerup", 51, 82, 126);
                return {
                    pinched,
                    afterLift,
                    rebased,
                    cameraFrames:
                        root.__profileLensContextMetrics.cameraFrames - before.cameraFrames,
                    moveEnds: root.__profileLensContextMetrics.moveEnds - before.moveEnds
                };
            });
            expect(result.afterLift).toEqual(result.pinched);
            expect(result.rebased[0]).toBeCloseTo(result.pinched[0], 12);
            expect(result.rebased[3]).toBeCloseTo(result.pinched[3], 12);
            expect(result.rebased[4] - result.pinched[4]).toBeGreaterThanOrEqual(0);
            expect(result.rebased[4] - result.pinched[4]).toBeLessThanOrEqual(12);
            expect(result.rebased[5] - result.pinched[5]).toBeGreaterThanOrEqual(0);
            expect(result.rebased[5] - result.pinched[5]).toBeLessThanOrEqual(6);
            expect(result.cameraFrames).toBe(3);
            expect(result.moveEnds).toBe(1);
            await expect(page.locator(".profile-lens-header-title")).toHaveText("Entity A");
            return result;
        };
        const svg = await exercise(500);
        const canvas = await exercise(1);
        expect(canvas.pinched).toEqual(svg.pinched);
        expect(canvas.afterLift).toEqual(svg.afterLift);
        expect(canvas.rebased).toEqual(svg.rebased);
    });

    test("does not focus a fallback feature when physical drag enters a partial scene", async ({ page }) => {
        await mount(page, {
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            packKeyMode: "canonical",
            navigationEnabled: true,
            entities: ["UNKNOWN", "USA"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        await expect(page.locator(".profile-lens-header-title")).toHaveText("UNKNOWN");
        const feature = await page.locator("[data-context-key]").boundingBox();
        expect(feature).not.toBeNull();
        const x = (feature?.x ?? 0) + (feature?.width ?? 0) / 2;
        const y = (feature?.y ?? 0) + (feature?.height ?? 0) / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 24, y, { steps: 8 });
        await page.mouse.up();
        await expect(page.locator(".profile-lens-header-title")).toHaveText("UNKNOWN");
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { select: number; filter: number } };
        }).profileLensHost.calls);
        expect(calls).toMatchObject({ select: 0, filter: 0 });
        const movedFeature = await page.locator("[data-context-key]").boundingBox();
        await page.mouse.click(
            (movedFeature?.x ?? 0) + (movedFeature?.width ?? 0) / 2,
            (movedFeature?.y ?? 0) + (movedFeature?.height ?? 0) / 2
        );
        await expect(page.locator(".profile-lens-header-title")).toHaveText("USA");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { select: number } };
        }).profileLensHost.calls.select)).toBe(1);
    });

    test("keeps overscanned Canvas point pixels and picking aligned after camera movement", async ({ page }) => {
        await mount(page, {
            contextMode: "boundGeometry",
            navigationEnabled: true,
            svgFeatureThreshold: 1,
            pointSize: 24,
            entities: ["Point A", "Point B"],
            geometryTexts: ["POINT (0 0)", "POINT (100 0)"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const surface = page.locator(".profile-lens-context");
        const bounds = await surface.boundingBox();
        expect(bounds).not.toBeNull();
        await surface.focus();
        await surface.dispatchEvent("keydown", { key: "+" });
        const centerX = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
        const centerY = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX + 100, centerY, { steps: 10 });
        await page.mouse.up();
        const target = await surface.evaluate((node) => {
            const root = node as HTMLElement;
            const bounds = root.getBoundingClientRect();
            const transform = root.querySelector(".profile-lens-context-outline-layer")
                ?.getAttribute("transform");
            const values = transform?.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number);
            if (!values || values.length !== 6) {
                throw new Error(`point camera transform is invalid: ${transform}`);
            }
            const x = values[0] * -10 + values[4];
            const y = values[3] * (bounds.height / 2) + values[5];
            const canvas = root.querySelector("canvas") as HTMLCanvasElement;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("display Canvas context is missing");
            const pixelX = Math.floor(x * canvas.width / bounds.width);
            const pixelY = Math.floor(y * canvas.height / bounds.height);
            return {
                x: bounds.left + x,
                y: bounds.top + y,
                alpha: context.getImageData(pixelX, pixelY, 1, 1).data[3]
            };
        });
        expect(target.x).toBeGreaterThanOrEqual(bounds?.x ?? 0);
        expect(target.alpha).toBeGreaterThan(0);
        await page.mouse.click(target.x, target.y);
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: {
                calls: { select: number; lastSelectedKey: string | null };
            };
        }).profileLensHost.calls);
        expect(calls.select).toBe(1);
        expect(calls.lastSelectedKey).toContain("entity:0");
    });

    test("keeps world, state, and county camera frames inside the no-rebuild budget", async ({ page }) => {
        const cases = [
            {
                name: "world",
                contextPack: "worldCountries",
                worldDetail: "50m",
                packKeyMode: "canonical",
                entities: WORLD_50_KEYS,
                svgFeatureThreshold: 500,
                svgVertexThreshold: 100000
            },
            {
                name: "state",
                contextPack: "usStates",
                packKeyMode: "geoid2",
                entities: STATE_KEYS,
                svgFeatureThreshold: 500,
                svgVertexThreshold: 100000
            },
            {
                name: "county",
                contextPack: "usCounties",
                packKeyMode: "geoid5",
                entities: COUNTY_KEYS,
                svgFeatureThreshold: 1,
                svgVertexThreshold: 100
            }
        ];
        const observed: Array<Record<string, unknown>> = [];
        for (const value of cases) {
            await mount(page, {
                contextMode: "builtInPack",
                navigationEnabled: true,
                contextPack: value.contextPack,
                worldDetail: value.worldDetail,
                packKeyMode: value.packKeyMode,
                svgFeatureThreshold: value.svgFeatureThreshold,
                svgVertexThreshold: value.svgVertexThreshold,
                entities: value.entities,
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            const surface = page.locator(".profile-lens-context");
            const bounds = await surface.boundingBox();
            expect(bounds).not.toBeNull();
            const before = await surface.evaluate((node) => {
                const metrics = (node as HTMLElement & {
                    __profileLensContextMetrics?: {
                        sceneBuilds: number;
                        sceneBuildDurationMs: number;
                        svgGeometryBuilds: number;
                        svgGeometryBuildDurationMs: number;
                        canvasRasterBuilds: number;
                        canvasRasterBuildDurationMs: number;
                        canvasPickingBuilds: number;
                        canvasPickingBuildDurationMs: number;
                        cameraFrames: number;
                        moveEnds: number;
                        cameraFrameDurationsMs: number[];
                    };
                }).__profileLensContextMetrics;
                if (!metrics) throw new Error("context metrics are missing");
                return { ...metrics, cameraFrameDurationsMs: [...metrics.cameraFrameDurationsMs] };
            });
            const header = await page.locator(".profile-lens-header-title").textContent();
            const centerX = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
            const centerY = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
            await page.mouse.move(centerX, centerY);
            await page.mouse.down();
            await page.mouse.move(centerX - 80, centerY + 24, { steps: 20 });
            await page.mouse.up();
            await expect(page.locator(".profile-lens-header-title")).toHaveText(header ?? "");
            expect(await page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: { select: number } };
            }).profileLensHost.calls.select)).toBe(0);
            for (let index = 0; index < 5; index++) {
                await page.mouse.wheel(0, -20);
            }
            const presentedFrameDurations = await surface.evaluate(async (node) => {
                const root = node as HTMLElement;
                const bounds = root.getBoundingClientRect();
                const fire = (type: string, id: number, x: number, y: number) => {
                    root.dispatchEvent(new PointerEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        pointerId: id,
                        pointerType: "touch",
                        button: 0,
                        clientX: bounds.left + x,
                        clientY: bounds.top + y
                    }));
                };
                const nextFrame = () => new Promise<number>((resolveFrame) => {
                    requestAnimationFrame(resolveFrame);
                });
                const durations: number[] = [];
                fire("pointerdown", 41, bounds.width / 2 - 60, bounds.height / 2);
                fire("pointerdown", 42, bounds.width / 2 + 60, bounds.height / 2);
                for (let index = 0; index < 35; index++) {
                    const started = performance.now();
                    fire(
                        "pointermove",
                        42,
                        bounds.width / 2 + 62 + index * 2,
                        bounds.height / 2 + index * 0.2
                    );
                    durations.push((await nextFrame()) - started);
                }
                fire("pointerup", 42, bounds.width / 2 + 132, bounds.height / 2 + 7);
                fire("pointerup", 41, bounds.width / 2 - 60, bounds.height / 2);
                return durations;
            });
            await page.waitForTimeout(150);
            const after = await surface.evaluate((node) => {
                const metrics = (node as HTMLElement & {
                    __profileLensContextMetrics?: {
                        sceneBuilds: number;
                        sceneBuildDurationMs: number;
                        svgGeometryBuilds: number;
                        svgGeometryBuildDurationMs: number;
                        canvasRasterBuilds: number;
                        canvasRasterBuildDurationMs: number;
                        canvasPickingBuilds: number;
                        canvasPickingBuildDurationMs: number;
                        cameraFrames: number;
                        moveEnds: number;
                        maxCameraFrameDurationMs: number;
                        cameraFrameDurationsMs: number[];
                    };
                }).__profileLensContextMetrics;
                if (!metrics) throw new Error("context metrics are missing");
                return { ...metrics, cameraFrameDurationsMs: [...metrics.cameraFrameDurationsMs] };
            });
            expect(after.sceneBuilds).toBe(before.sceneBuilds);
            expect(after.svgGeometryBuilds).toBe(before.svgGeometryBuilds);
            expect(after.canvasRasterBuilds).toBe(before.canvasRasterBuilds);
            expect(after.canvasPickingBuilds).toBe(before.canvasPickingBuilds);
            const frameDelta = after.cameraFrames - before.cameraFrames;
            expect(frameDelta).toBeGreaterThanOrEqual(40);
            const moveEndDelta = after.moveEnds - before.moveEnds;
            expect(moveEndDelta).toBe(3);
            const durations = after.cameraFrameDurationsMs
                .slice(-frameDelta)
                .sort((left, right) => left - right);
            const p95 = durations[Math.floor((durations.length - 1) * 0.95)] ?? Number.POSITIVE_INFINITY;
            expect(p95).toBeLessThanOrEqual(16.7);
            expect(after.maxCameraFrameDurationMs).toBeLessThanOrEqual(33.4);
            const presented = [...presentedFrameDurations].sort((left, right) => left - right);
            const presentedP95 = presented[
                Math.floor((presented.length - 1) * 0.95)
            ] ?? Number.POSITIVE_INFINITY;
            const presentedMax = presented.at(-1) ?? Number.POSITIVE_INFINITY;
            expect(presentedP95).toBeLessThanOrEqual(33.4);
            expect(presentedMax).toBeLessThanOrEqual(50);
            await expect(page.locator(".profile-lens-header-title")).toHaveText(header ?? "");
            const calls = await page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: { select: number; filter: number } };
            }).profileLensHost.calls);
            expect(calls).toMatchObject({ select: 0, filter: 0 });
            observed.push({
                name: value.name,
                frameDelta,
                moveEndDelta,
                p95,
                max: after.maxCameraFrameDurationMs,
                presentedP95,
                presentedMax,
                sceneBuilds: after.sceneBuilds,
                sceneBuildDurationMs: after.sceneBuildDurationMs,
                svgGeometryBuilds: after.svgGeometryBuilds,
                svgGeometryBuildDurationMs: after.svgGeometryBuildDurationMs,
                canvasRasterBuilds: after.canvasRasterBuilds,
                canvasRasterBuildDurationMs: after.canvasRasterBuildDurationMs,
                canvasPickingBuilds: after.canvasPickingBuilds,
                canvasPickingBuildDurationMs: after.canvasPickingBuildDurationMs
            });
        }
        console.log(`Viewport camera metrics: ${JSON.stringify(observed)}`);
    });

    test("bounds Canvas and redirects disabled physical context focus", async ({ page }) => {
        const started = Date.now();
        await mount(page, {
            contextMode: "builtInPack",
            contextPack: "usCounties",
            svgFeatureThreshold: 1,
            navigationEnabled: true,
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
        const reset = page.locator(".profile-lens-context-reset");
        await expect(reset).toHaveAttribute("tabindex", "-1");
        await expect(reset).toBeHidden();
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
                navigationEnabled: true,
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
                    normalBucketChecks: number;
                    normalCandidateValidationAttempts: number;
                    normalPickingSuccesses: number;
                    fallbackQueries: number;
                    fallbackCandidateReferencesRead: number;
                    fallbackCandidateValidations: number;
                    maxFallbackCandidatesExamined: number;
                    spatialBucketEntries: number;
                    maxBucketOccupancy: number;
                    spatialReferenceBudget: number;
                    bucketSize: number;
                    pickingScaleX: number;
                    pickingScaleY: number;
                    displayBackingWidth: number;
                    displayBackingHeight: number;
                    baseRasterBackingWidth: number;
                    baseRasterBackingHeight: number;
                    pickingBackingWidth: number;
                    pickingBackingHeight: number;
                    totalBackingPixels: number;
                };
                const root = node as HTMLElement & { __profileLensCanvasHitMetrics: Metrics };
                const bounds = root.getBoundingClientRect();
                root.dispatchEvent(new WheelEvent("wheel", {
                    bubbles: true,
                    cancelable: true,
                    deltaY: -180,
                    deltaMode: 0,
                    clientX: bounds.left + bounds.width / 2,
                    clientY: bounds.top + bounds.height / 2
                }));
                root.dispatchEvent(new PointerEvent("pointerdown", {
                    bubbles: true,
                    cancelable: true,
                    pointerId: 71,
                    pointerType: "mouse",
                    button: 0,
                    clientX: bounds.left + bounds.width / 2,
                    clientY: bounds.top + bounds.height / 2
                }));
                root.dispatchEvent(new PointerEvent("pointermove", {
                    bubbles: true,
                    cancelable: true,
                    pointerId: 71,
                    pointerType: "mouse",
                    buttons: 1,
                    clientX: bounds.left + bounds.width / 2 - 30,
                    clientY: bounds.top + bounds.height / 2 + 10
                }));
                root.dispatchEvent(new PointerEvent("pointerup", {
                    bubbles: true,
                    cancelable: true,
                    pointerId: 71,
                    pointerType: "mouse",
                    button: 0,
                    clientX: bounds.left + bounds.width / 2 - 30,
                    clientY: bounds.top + bounds.height / 2 + 10
                }));
                const cameraTransform = root.querySelector(".profile-lens-context-outline-layer")
                    ?.getAttribute("transform");
                if (!cameraTransform || cameraTransform === "matrix(1,0,0,1,0,0)") {
                    throw new Error("county inverse-picking probe did not move the camera");
                }
                const before = { ...root.__profileLensCanvasHitMetrics };
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
                    normalBucketChecks:
                        after.normalBucketChecks - before.normalBucketChecks,
                    normalCandidateValidationAttempts:
                        after.normalCandidateValidationAttempts
                        - before.normalCandidateValidationAttempts,
                    normalPickingSuccesses:
                        after.normalPickingSuccesses - before.normalPickingSuccesses,
                    fallbackQueries: after.fallbackQueries - before.fallbackQueries,
                    fallbackCandidateReferencesRead:
                        after.fallbackCandidateReferencesRead
                        - before.fallbackCandidateReferencesRead,
                    fallbackCandidateValidations:
                        after.fallbackCandidateValidations
                        - before.fallbackCandidateValidations,
                    maxFallbackCandidatesExamined: after.maxFallbackCandidatesExamined,
                    spatialBucketEntries: after.spatialBucketEntries,
                    maxBucketOccupancy: after.maxBucketOccupancy,
                    spatialReferenceBudget: after.spatialReferenceBudget,
                    bucketSize: after.bucketSize,
                    displayBackingWidth: after.displayBackingWidth,
                    displayBackingHeight: after.displayBackingHeight,
                    baseRasterBackingWidth: after.baseRasterBackingWidth,
                    baseRasterBackingHeight: after.baseRasterBackingHeight,
                    pickingBackingWidth: after.pickingBackingWidth,
                    pickingBackingHeight: after.pickingBackingHeight,
                    totalBackingPixels: after.totalBackingPixels,
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
