import { expect, test, Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
const cartographyEvidence = resolve(root, "dist", "evidence", "cartography");

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
        entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
        periods: ["Period 1", "Period 2"],
        bands: ["Band 1", "Band 2", "Band 3", "Band 4", "Band 5"],
        series: ["Series X", "Series Y"],
        profiles: ["Metric A", "Metric B", "Metric C"],
        ...options
    });
}

async function renderedForegroundAt(
    page: Page,
    screenshot: Buffer,
    point: { readonly x: number; readonly y: number },
    foreground: string,
    background: string
): Promise<{ foregroundDominant: number; minimumForegroundDistance: number }> {
    return page.evaluate(async ({ encoded, sample, foregroundHex, backgroundHex }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Pixel evidence requires a 2D context.");
        context.drawImage(image, 0, 0);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const parseHex = (value: string): readonly [number, number, number] => [
            Number.parseInt(value.slice(1, 3), 16),
            Number.parseInt(value.slice(3, 5), 16),
            Number.parseInt(value.slice(5, 7), 16)
        ];
        const foregroundRgb = parseHex(foregroundHex);
        const backgroundRgb = parseHex(backgroundHex);
        let foregroundDominant = 0;
        let minimumForegroundDistance = Number.POSITIVE_INFINITY;
        const centerX = Math.round(sample.x);
        const centerY = Math.round(sample.y);
        for (let y = centerY - 2; y <= centerY + 2; y++) {
            for (let x = centerX - 2; x <= centerX + 2; x++) {
                if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) continue;
                const index = (y * imageData.width + x) * 4;
                const foregroundDistance = Math.abs(imageData.data[index] - foregroundRgb[0])
                    + Math.abs(imageData.data[index + 1] - foregroundRgb[1])
                    + Math.abs(imageData.data[index + 2] - foregroundRgb[2]);
                const backgroundDistance = Math.abs(imageData.data[index] - backgroundRgb[0])
                    + Math.abs(imageData.data[index + 1] - backgroundRgb[1])
                    + Math.abs(imageData.data[index + 2] - backgroundRgb[2]);
                minimumForegroundDistance = Math.min(
                    minimumForegroundDistance,
                    foregroundDistance
                );
                if (foregroundDistance < backgroundDistance) foregroundDominant++;
            }
        }
        return { foregroundDominant, minimumForegroundDistance };
    }, {
        encoded: screenshot.toString("base64"),
        sample: point,
        foregroundHex: foreground,
        backgroundHex: background
    });
}

async function isolatedLakePixel(
    page: Page,
    full: Buffer,
    standard: Buffer,
    candidates: readonly { readonly x: number; readonly y: number }[],
    foreground: string,
    background: string
): Promise<{
    point: { readonly x: number; readonly y: number };
    fullForegroundDominant: number;
    standardForegroundDominant: number;
}> {
    return page.evaluate(async ({
        fullPng,
        standardPng,
        points,
        foregroundHex,
        backgroundHex
    }) => {
        const decode = async (encoded: string): Promise<ImageData> => {
            const image = new Image();
            image.src = `data:image/png;base64,${encoded}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Lake pixel evidence requires a 2D context.");
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height);
        };
        const parseHex = (value: string): readonly [number, number, number] => [
            Number.parseInt(value.slice(1, 3), 16),
            Number.parseInt(value.slice(3, 5), 16),
            Number.parseInt(value.slice(5, 7), 16)
        ];
        const [fullImage, standardImage] = await Promise.all([
            decode(fullPng),
            decode(standardPng)
        ]);
        const foregroundRgb = parseHex(foregroundHex);
        const backgroundRgb = parseHex(backgroundHex);
        const evidenceAt = (
            image: ImageData,
            point: { readonly x: number; readonly y: number }
        ): { foregroundDominant: number; minimumForegroundDistance: number } => {
            let foregroundDominant = 0;
            let minimumForegroundDistance = Number.POSITIVE_INFINITY;
            const centerX = Math.round(point.x);
            const centerY = Math.round(point.y);
            for (let y = centerY - 2; y <= centerY + 2; y++) {
                for (let x = centerX - 2; x <= centerX + 2; x++) {
                    if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
                    const index = (y * image.width + x) * 4;
                    const foregroundDistance = Math.abs(image.data[index] - foregroundRgb[0])
                        + Math.abs(image.data[index + 1] - foregroundRgb[1])
                        + Math.abs(image.data[index + 2] - foregroundRgb[2]);
                    const backgroundDistance = Math.abs(image.data[index] - backgroundRgb[0])
                        + Math.abs(image.data[index + 1] - backgroundRgb[1])
                        + Math.abs(image.data[index + 2] - backgroundRgb[2]);
                    minimumForegroundDistance = Math.min(
                        minimumForegroundDistance,
                        foregroundDistance
                    );
                    if (foregroundDistance < backgroundDistance) foregroundDominant++;
                }
            }
            return { foregroundDominant, minimumForegroundDistance };
        };
        for (const point of points) {
            const fullEvidence = evidenceAt(fullImage, point);
            const standardEvidence = evidenceAt(standardImage, point);
            if (
                fullEvidence.foregroundDominant > 0
                && fullEvidence.minimumForegroundDistance < 200
                && standardEvidence.foregroundDominant === 0
            ) {
                return {
                    point,
                    fullForegroundDominant: fullEvidence.foregroundDominant,
                    standardForegroundDominant: standardEvidence.foregroundDominant
                };
            }
        }
        throw new Error("No isolated rendered lake-boundary pixel was found.");
    }, {
        fullPng: full.toString("base64"),
        standardPng: standard.toString("base64"),
        points: candidates,
        foregroundHex: foreground,
        backgroundHex: background
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
            entities: ["Entity A", "Entity B"],
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
                navigationEnabled: true,
                entities: ["Entity A", "Entity B", "Entity C", "Entity D"]
            };
            await mount(page, options);
            const fills = await page.evaluate(() =>
                Array.from(document.querySelectorAll(".profile-lens-target rect.profile-lens-bar"))
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

    test("contains physical clamped wheel input without a no-op settle", async ({ page }) => {
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
        expect(result.cameraFrames - before.cameraFrames).toBeLessThanOrEqual(1);
        expect(result.moveEnds - before.moveEnds).toBe(0);
        expect(result.defaults).toEqual([false, false, false, false]);
        expect(result.bubbled).toBe(4);
        expect(result.windowScrollAfter).toBe(result.windowScrollBefore);
        expect(result.rootScrollAfter).toBe(result.rootScrollBefore);
        expect(result.zeroPrevented).toBe(false);
        expect(result.invalidPrevented).toBe(false);
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { select: number; filter: number } };
        }).profileLensHost.calls);
        expect(calls).toMatchObject({ select: 0, filter: 0 });
    });

    test("releases physical wheel input to page scroll at zoom limits", async ({ page }) => {
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
        await surface.evaluate(() => {
            const container = document.getElementById("visual-root")!;
            container.style.position = "fixed";
            container.style.inset = "0 auto auto 0";
            document.body.style.height = "3000px";
            window.scrollTo(0, 200);
        });
        const bounds = await surface.boundingBox();
        expect(bounds).not.toBeNull();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        // Each clamped tick is released to the page. Chromium latches the first tick of an
        // opposite-direction pair (the second tick only cancels the first's animation), so
        // verify the released up-tick lands by pausing between direction changes.
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(150);
        const scrolledUp = await page.evaluate(() => window.scrollY);
        expect(scrolledUp).toBeLessThan(200);
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(150);
        const scrolledBack = await page.evaluate(() => window.scrollY);
        expect(scrolledBack).toBeGreaterThan(scrolledUp);
        // A zoomable camera still claims the wheel for map zooming.
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: true,
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const freeBounds = await surface.boundingBox();
        expect(freeBounds).not.toBeNull();
        await surface.evaluate(() => {
            const container = document.getElementById("visual-root")!;
            container.style.position = "fixed";
            container.style.inset = "0 auto auto 0";
            document.body.style.height = "3000px";
            window.scrollTo(0, 200);
        });
        await page.mouse.move(
            (freeBounds?.x ?? 0) + (freeBounds?.width ?? 0) / 2,
            (freeBounds?.y ?? 0) + (freeBounds?.height ?? 0) / 2
        );
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(150);
        const heldScroll = await surface.evaluate((node) => ({
            scrollY: window.scrollY,
            frames: (node as HTMLElement & {
                __profileLensContextMetrics: { cameraFrames: number };
            }).__profileLensContextMetrics.cameraFrames
        }));
        expect(heldScroll.scrollY).toBe(200);
        expect(heldScroll.frames).toBeGreaterThan(0);
    });

    test("passes momentum wheel ticks through to the page after crossing a zoom limit mid-gesture", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: true,
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const surface = page.locator(".profile-lens-context");
        await surface.evaluate(() => {
            const container = document.getElementById("visual-root")!;
            container.style.position = "fixed";
            container.style.inset = "0 auto auto 0";
            document.body.style.height = "6000px";
            window.scrollTo(0, 200);
        });
        const bounds = await surface.boundingBox();
        expect(bounds).not.toBeNull();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        // Momentum-style burst: effective zoom ticks carry the camera to its ceiling while the
        // page must not move; every tick stays handled until the limit is crossed.
        for (let index = 0; index < 24; index++) {
            await page.mouse.wheel(0, -40);
        }
        const heldScroll = await surface.evaluate((node) => ({
            frames: (node as HTMLElement & {
                __profileLensContextMetrics: { cameraFrames: number };
            }).__profileLensContextMetrics.cameraFrames
        }));
        expect(heldScroll.frames).toBeGreaterThan(0);
        // Re-center the viewport so released ticks have room to scroll upward, then keep spinning
        // the same direction without pausing longer than the settle window.
        await page.evaluate(() => window.scrollTo(0, 300));
        for (let index = 0; index < 5; index++) {
            await page.mouse.wheel(0, -40);
        }
        const scrolled = await page.evaluate(() => window.scrollY);
        expect(scrolled).toBeLessThan(300);
        // Exactly one settle commit covers the entire gesture despite ~29 physical ticks.
        await page.waitForTimeout(250);
        const moveEnds = await surface.evaluate((node) =>
            (node as HTMLElement & {
                __profileLensContextMetrics: { moveEnds: number };
            }).__profileLensContextMetrics.moveEnds);
        expect(moveEnds).toBe(1);
    });

    test("cancels stale wheel settles across physical input ownership changes", async ({ page }) => {
        for (const value of [
            { action: "drag", moveEnds: 1, selections: 1 },
            { action: "click", moveEnds: 0, selections: 1 },
            { action: "arrow", moveEnds: 0, selections: 0 },
            { action: "pinch", moveEnds: 1, selections: 1 },
            { action: "cancel", moveEnds: 0, selections: 0 },
            { action: "destroy", moveEnds: 0, selections: 0 }
        ]) {
            await mount(page, {
                contextMode: "grid",
                navigationEnabled: true,
                interactionMode: "reportSelection",
                entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            const surface = page.locator(".profile-lens-context");
            const bounds = await surface.boundingBox();
            expect(bounds).not.toBeNull();
            const centerX = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
            const centerY = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
            const before = await surface.evaluate((node) => ({
                moveEnds: (node as HTMLElement & {
                    __profileLensContextMetrics: { moveEnds: number };
                }).__profileLensContextMetrics.moveEnds,
                selections: (window as unknown as {
                    profileLensHost: { calls: { select: number } };
                }).profileLensHost.calls.select
            }));
            await page.mouse.move(centerX, centerY);
            await page.mouse.wheel(0, -120);

            if (value.action === "drag") {
                await page.mouse.down();
                await page.mouse.move(centerX + 40, centerY, { steps: 8 });
                await page.mouse.up();
            } else if (value.action === "click") {
                await page.mouse.click(centerX, centerY);
            } else if (value.action === "arrow") {
                await surface.focus();
                await surface.press("ArrowLeft");
            } else if (value.action === "pinch") {
                await surface.evaluate((node) => {
                    const root = node as HTMLElement;
                    const bounds = root.getBoundingClientRect();
                    const fire = (type: string, id: number, x: number) => {
                        root.dispatchEvent(new PointerEvent(type, {
                            bubbles: true,
                            cancelable: true,
                            pointerId: id,
                            pointerType: "touch",
                            button: 0,
                            clientX: bounds.left + x,
                            clientY: bounds.top + bounds.height / 2
                        }));
                    };
                    fire("pointerdown", 201, bounds.width / 2 - 50);
                    fire("pointerdown", 202, bounds.width / 2 + 50);
                    fire("pointermove", 202, bounds.width / 2 + 90);
                    fire("pointerup", 202, bounds.width / 2 + 90);
                    fire("pointerup", 201, bounds.width / 2 - 50);
                });
            } else if (value.action === "cancel") {
                await surface.evaluate((node) => {
                    const root = node as HTMLElement;
                    const bounds = root.getBoundingClientRect();
                    root.dispatchEvent(new PointerEvent("pointerdown", {
                        bubbles: true,
                        cancelable: true,
                        pointerId: 203,
                        pointerType: "mouse",
                        button: 0,
                        clientX: bounds.left + bounds.width / 2,
                        clientY: bounds.top + bounds.height / 2
                    }));
                    root.dispatchEvent(new PointerEvent("pointercancel", {
                        bubbles: true,
                        cancelable: true,
                        pointerId: 203,
                        pointerType: "mouse",
                        clientX: bounds.left + bounds.width / 2,
                        clientY: bounds.top + bounds.height / 2
                    }));
                });
            } else {
                await page.evaluate(() => {
                    (window as unknown as {
                        profileLensInstance: { destroy: () => void };
                    }).profileLensInstance.destroy();
                });
            }
            await page.waitForTimeout(250);
            const after = await surface.evaluate((node) => ({
                moveEnds: (node as HTMLElement & {
                    __profileLensContextMetrics: { moveEnds: number };
                }).__profileLensContextMetrics.moveEnds,
                selections: (window as unknown as {
                    profileLensHost: { calls: { select: number } };
                }).profileLensHost.calls.select
            }));
            expect(after.moveEnds - before.moveEnds, value.action).toBe(value.moveEnds);
            expect(after.selections - before.selections, value.action).toBe(value.selections);
        }
    });

    test("settles only the latest physical wheel generation", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: true,
            interactionMode: "reportSelection",
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const surface = page.locator(".profile-lens-context");
        const bounds = await surface.boundingBox();
        const centerX = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
        const centerY = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
        const before = await surface.evaluate((node) =>
            (node as HTMLElement & {
                __profileLensContextMetrics: { moveEnds: number };
            }).__profileLensContextMetrics.moveEnds);
        await page.mouse.move(centerX, centerY);
        for (let index = 0; index < 4; index++) {
            await page.mouse.wheel(0, -30);
        }
        await page.waitForTimeout(250);
        const result = await surface.evaluate((node) => ({
            moveEnds: (node as HTMLElement & {
                __profileLensContextMetrics: { moveEnds: number };
            }).__profileLensContextMetrics.moveEnds,
            calls: (window as unknown as {
                profileLensHost: {
                    calls: {
                        select: number;
                        maxSelectionInFlight: number;
                    };
                };
            }).profileLensHost.calls
        }));
        expect(result.moveEnds - before).toBe(1);
        expect(result.calls.select).toBe(1);
        expect(result.calls.maxSelectionInFlight).toBe(1);
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
        await expect(page.locator(".profile-lens-context")).toHaveAttribute("aria-setsize", "177");
        await expect(page.locator(".profile-lens-context-attribution"))
            .toContainText("Made with Natural Earth");
        await expect(page.locator("[data-context-key='USA']")).toHaveCount(1);
        await expect(page.locator("[data-context-key='NE:KOS']")).toHaveCount(1);
        expect(await page.locator(".profile-lens-context-semantic [role='option']").count())
            .toBeLessThanOrEqual(100);
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

    test("renders professional US hierarchy with SVG/Canvas parity and bounded work", async ({ page }) => {
        mkdirSync(cartographyEvidence, { recursive: true });
        const common = {
            referenceDetail: "full",
            labelDensity: "detailed",
            showCenterProbe: false,
            homeView: "fit",
            entities: [],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        };
        await mount(page, {
            ...common,
            contextMode: "builtInPack",
            contextPack: "usStates",
            svgFeatureThreshold: 500
        });
        const svgOrder = await page.locator(".profile-lens-context-camera-layer").evaluate((node) =>
            [...node.querySelectorAll("[data-reference-role], [data-context-key]")]
                .map((entry) => entry.getAttribute("data-reference-role") ?? "interactive")
                .filter((value, index, values) => index === 0 || value !== values[index - 1]));
        expect(svgOrder).toEqual(["land", "interactive", "admin1", "coastline", "insetFrame"]);
        await expect(page.locator("[data-reference-role='admin1']"))
            .toHaveAttribute("stroke-width", "1.1");
        await expect(page.locator("[data-reference-role='admin1']"))
            .toHaveAttribute("vector-effect", "non-scaling-stroke");
        await expect(page.locator("[data-label-role='inset']")).toHaveCount(7);
        await expect(page.locator(".profile-lens-context-attribution"))
            .toContainText("inset distance and area are not comparable");
        expect(await page.locator(".profile-lens-context-map-label").count()).toBeLessThanOrEqual(40);
        await page.locator(".profile-lens-context").screenshot({
            path: resolve(cartographyEvidence, "us-states-svg.png")
        });

        await mount(page, {
            ...common,
            contextMode: "builtInPack",
            contextPack: "usCounties",
            svgFeatureThreshold: 1
        });
        const context = page.locator(".profile-lens-context");
        const initial = await context.evaluate((node) => ({
            ...(node as HTMLElement & {
                __profileLensContextMetrics: {
                    canvasReferenceLineRoles: string[];
                    canvasReferenceCompositeOrder: string[];
                    canvasReferenceScreenLineWidths: number[];
                    referenceGeometryBuilds: number;
                    canvasRasterBuilds: number;
                    canvasPickingBuilds: number;
                    maxVisibleLabels: number;
                    labelCandidatesEvaluated: number;
                };
            }).__profileLensContextMetrics
        }));
        expect(initial.canvasReferenceLineRoles).not.toContain("admin2");
        expect(initial.canvasReferenceCompositeOrder).toEqual([
            "interactive", "admin1", "coastline", "insetFrame"
        ]);
        await context.screenshot({
            path: resolve(cartographyEvidence, "us-counties-canvas-home.png")
        });
        const bounds = await context.boundingBox();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        for (let index = 0; index < 12; index++) {
            await page.mouse.wheel(0, -120);
            await page.waitForTimeout(20);
        }
        await page.waitForTimeout(250);
        const zoomed = await context.evaluate((node) => ({
            ...(node as HTMLElement & {
                __profileLensContextMetrics: typeof initial;
            }).__profileLensContextMetrics
        }));
        expect(zoomed.canvasReferenceCompositeOrder).toEqual([
            "interactive", "admin2", "admin1", "coastline", "insetFrame"
        ]);
        const stateIndex = zoomed.canvasReferenceLineRoles.indexOf("admin1");
        const countyIndex = zoomed.canvasReferenceLineRoles.indexOf("admin2");
        expect(zoomed.canvasReferenceScreenLineWidths[stateIndex]).toBe(1.1);
        expect(zoomed.canvasReferenceScreenLineWidths[countyIndex]).toBe(0.35);
        expect(zoomed.referenceGeometryBuilds).toBe(initial.referenceGeometryBuilds);
        expect(zoomed.canvasRasterBuilds).toBe(initial.canvasRasterBuilds);
        expect(zoomed.canvasPickingBuilds).toBe(initial.canvasPickingBuilds);
        expect(zoomed.maxVisibleLabels).toBeLessThanOrEqual(40);
        expect(zoomed.labelCandidatesEvaluated - initial.labelCandidatesEvaluated)
            .toBeLessThanOrEqual(3298 * 13);
        await context.screenshot({
            path: resolve(cartographyEvidence, "us-counties-canvas-zoom.png")
        });
    });

    test("renders complete binding-free world, state, and county packs", async ({ page }) => {
        for (const value of [
            { pack: "worldCountries", packKeyMode: "canonical", count: 177, canvas: false },
            { pack: "usStates", packKeyMode: "geoid2", count: 56, canvas: false },
            { pack: "usCounties", packKeyMode: "geoid5", count: 3235, canvas: true }
        ]) {
            await mount(page, {
                contextMode: "builtInPack",
                contextPack: value.pack,
                packKeyMode: value.packKeyMode,
                entities: [],
                periods: [],
                bands: [],
                series: [],
                profiles: []
            });
            const surface = page.locator(".profile-lens-context");
            await expect(surface).toHaveAttribute("aria-setsize", String(value.count));
            await expect(surface).toHaveClass(/profile-lens-context-navigation-active/);
            await expect(page.locator(".profile-lens-target")).toHaveCount(0);
            await expect(page.locator(".profile-lens-table"))
                .toContainText("No data in current report context");
            const result = await page.evaluate(() => ({
                failed: (window as unknown as {
                    profileLensEvents: { failed: number };
                }).profileLensEvents.failed,
                select: (window as unknown as {
                    profileLensHost: { calls: { select: number } };
                }).profileLensHost.calls.select
            }));
            expect(result).toEqual({ failed: 0, select: 0 });
            const canvasWidth = await page.locator(".profile-lens-context-canvas")
                .evaluate((canvas) => (canvas as HTMLCanvasElement).width);
            expect(canvasWidth > 1).toBe(value.canvas);
        }
    });

    test("binds later data without resetting the binding-free camera or base", async ({ page }) => {
        const base = {
            width: 1280,
            height: 620,
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            packKeyMode: "canonical",
            interactionMode: "localOnly",
            entities: [] as string[],
            periods: [] as string[],
            bands: ["Band 1"],
            series: [] as string[],
            profiles: ["Metric A"]
        };
        await mount(page, base);
        const surface = page.locator(".profile-lens-context");
        await surface.focus();
        await surface.press("+");
        await surface.press("Shift+ArrowLeft");
        const before = await surface.evaluate((node) => {
            const root = node as HTMLElement & {
                __profileLensContextMetrics: {
                    sceneBuilds: number;
                    svgGeometryBuilds: number;
                    canvasRasterBuilds: number;
                    canvasPickingBuilds: number;
                    cameraFrames: number;
                };
            };
            return {
                transform: root.querySelector(".profile-lens-context-outline-layer")
                    ?.getAttribute("transform"),
                metrics: { ...root.__profileLensContextMetrics }
            };
        });
        await page.evaluate((options) => {
            const scope = window as unknown as {
                buildProfileLensDataView: (value: unknown) => unknown;
                profileLensUpdate: (value: unknown) => void;
                profileLensDataView: unknown;
            };
            scope.profileLensUpdate({
                width: options.width,
                height: options.height,
                dataViews: [scope.buildProfileLensDataView({
                    ...options,
                    entities: ["USA"]
                })],
                jsonFilters: []
            });
        }, base);
        const after = await surface.evaluate((node) => {
            const root = node as HTMLElement & {
                __profileLensContextMetrics: {
                    sceneBuilds: number;
                    svgGeometryBuilds: number;
                    canvasRasterBuilds: number;
                    canvasPickingBuilds: number;
                    cameraFrames: number;
                };
            };
            return {
                transform: root.querySelector(".profile-lens-context-outline-layer")
                    ?.getAttribute("transform"),
                metrics: { ...root.__profileLensContextMetrics }
            };
        });
        expect(after.transform).toBe(before.transform);
        expect(after.metrics.sceneBuilds).toBe(before.metrics.sceneBuilds + 1);
        expect(after.metrics.svgGeometryBuilds).toBe(before.metrics.svgGeometryBuilds);
        expect(after.metrics.canvasRasterBuilds).toBe(before.metrics.canvasRasterBuilds);
        expect(after.metrics.canvasPickingBuilds).toBe(before.metrics.canvasPickingBuilds);
        expect(after.metrics.cameraFrames).toBe(before.metrics.cameraFrames);
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
                entities: WORLD_50_KEYS.filter((_key, index) => index % 3 === 0),
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

    test("renders the professional world hierarchy with bounded screen labels", async ({ page }, testInfo) => {
        const config = {
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            worldDetail: "50m",
            referenceDetail: "full",
            showPhysicalLayers: true,
            showLabels: true,
            labelDensity: "detailed",
            showGraticule: true,
            contextLayout: "focusLens",
            homeView: "fill",
            interactionMode: "localOnly",
            entities: WORLD_50_KEYS.filter((_key, index) => index % 4 === 0),
            periods: ["2020", "2025"],
            bands: ["Youth", "Working age", "Older adults"],
            series: ["Community", "Comparison"],
            profiles: ["Population", "Income", "Education"],
            svgFeatureThreshold: 500
        };
        await mount(page, config);
        const roles = await page.locator(
            ".profile-lens-context-camera-layer > [data-reference-role],"
            + ".profile-lens-context-camera-layer > [data-context-key]"
        ).evaluateAll((nodes) => nodes.map((node) =>
            node.getAttribute("data-reference-role")
            ?? (node.hasAttribute("data-context-key") ? "interactive" : "")));
        expect(roles.indexOf("sphere")).toBeLessThan(roles.indexOf("land"));
        expect(roles.indexOf("land")).toBeLessThan(roles.indexOf("water"));
        expect(roles.indexOf("water")).toBeLessThan(roles.indexOf("graticule"));
        expect(roles.indexOf("graticule")).toBeLessThan(roles.indexOf("interactive"));
        expect(roles.lastIndexOf("interactive")).toBeLessThan(roles.indexOf("water-boundary"));
        expect(roles.indexOf("water-boundary")).toBeLessThan(roles.indexOf("coastline"));
        expect(roles.lastIndexOf("interactive")).toBeLessThan(roles.indexOf("coastline"));
        expect(roles.indexOf("coastline")).toBeLessThan(roles.indexOf("admin0"));
        const svgReferenceWidths = await page.locator(
            "[data-reference-role='water-boundary'],"
            + "[data-reference-role='graticule'],"
            + "[data-reference-role='coastline'],"
            + "[data-reference-role='admin0']"
        ).evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("stroke-width"))));
        const labels = page.locator(".profile-lens-context-map-label");
        expect(await labels.count()).toBeGreaterThan(0);
        expect(await labels.count()).toBeLessThanOrEqual(40);
        await expect(labels.first()).toHaveAttribute("font-size", "11");
        const semanticCount = await page.locator(
            ".profile-lens-context-semantic [role='option']"
        ).count();
        expect(semanticCount).toBeLessThanOrEqual(100);
        expect(await page.locator("[data-reference-role][data-context-key]").count()).toBe(0);
        await page.screenshot({
            path: process.env.PROFILE_LENS_SCREENSHOT_PATH
                ?? testInfo.outputPath("professional-world-hero.png"),
            fullPage: true
        });

        const before = await page.locator(".profile-lens-context").evaluate((node) => ({
            metrics: { ...(node as HTMLElement & {
                __profileLensContextMetrics: {
                    referenceGeometryBuilds: number;
                    svgGeometryBuilds: number;
                    canvasRasterBuilds: number;
                    canvasPickingBuilds: number;
                    labelLayoutUpdates: number;
                    maxVisibleLabels: number;
                };
            }).__profileLensContextMetrics },
            labelSize: node.querySelector(".profile-lens-context-map-label")
                ?.getAttribute("font-size")
        }));
        await page.locator(".profile-lens-context").press("+");
        await page.locator(".profile-lens-context").press("ArrowRight");
        const after = await page.locator(".profile-lens-context").evaluate((node) => ({
            metrics: { ...(node as HTMLElement & {
                __profileLensContextMetrics: typeof before.metrics;
            }).__profileLensContextMetrics },
            labelSize: node.querySelector(".profile-lens-context-map-label")
                ?.getAttribute("font-size")
        }));
        expect(after.metrics.referenceGeometryBuilds).toBe(before.metrics.referenceGeometryBuilds);
        expect(after.metrics.svgGeometryBuilds).toBe(before.metrics.svgGeometryBuilds);
        expect(after.metrics.canvasRasterBuilds).toBe(before.metrics.canvasRasterBuilds);
        expect(after.metrics.canvasPickingBuilds).toBe(before.metrics.canvasPickingBuilds);
        expect(after.metrics.labelLayoutUpdates).toBeGreaterThan(before.metrics.labelLayoutUpdates);
        expect(after.metrics.maxVisibleLabels).toBeLessThanOrEqual(40);
        expect(after.labelSize).toBe(before.labelSize);

        await mount(page, { ...config, svgFeatureThreshold: 1 });
        const canvasWidth = await page.locator(".profile-lens-context-canvas").evaluate(
            (canvas) => (canvas as HTMLCanvasElement).width
        );
        expect(canvasWidth).toBeGreaterThan(1);
        expect(await page.locator(".profile-lens-context-map-label").count())
            .toBeLessThanOrEqual(40);
        const canvasBefore = await page.locator(".profile-lens-context").evaluate((node) => ({
            ...(node as HTMLElement & {
                __profileLensContextMetrics: {
                    referenceGeometryBuilds: number;
                    canvasRasterBuilds: number;
                    canvasPickingBuilds: number;
                    canvasReferenceLineDraws: number;
                    canvasInteractivePathDraws: number;
                    canvasReferenceScreenLineWidths: number[];
                    canvasReferenceCompositeOrder: string[];
                };
            }).__profileLensContextMetrics
        }));
        for (let index = 0; index < 4; index++) {
            await page.locator(".profile-lens-context").press("+");
        }
        const canvasAfter = await page.locator(".profile-lens-context").evaluate((node) => ({
            ...(node as HTMLElement & {
                __profileLensContextMetrics: typeof canvasBefore;
            }).__profileLensContextMetrics
        }));
        expect(canvasAfter.canvasReferenceScreenLineWidths).toEqual(svgReferenceWidths);
        expect(canvasAfter.canvasReferenceScreenLineWidths)
            .toEqual(canvasBefore.canvasReferenceScreenLineWidths);
        expect(canvasAfter.canvasReferenceLineDraws).toBeGreaterThan(
            canvasBefore.canvasReferenceLineDraws
        );
        expect(canvasAfter.canvasInteractivePathDraws).toBeGreaterThan(
            canvasBefore.canvasInteractivePathDraws
        );
        expect(canvasAfter.canvasReferenceCompositeOrder).toEqual([
            "graticule",
            "interactive",
            "water",
            "coastline",
            "admin0"
        ]);
        expect(canvasAfter.referenceGeometryBuilds).toBe(canvasBefore.referenceGeometryBuilds);
        expect(canvasAfter.canvasRasterBuilds).toBe(canvasBefore.canvasRasterBuilds);
        expect(canvasAfter.canvasPickingBuilds).toBe(canvasBefore.canvasPickingBuilds);
    });

    test("keeps lake boundaries visible in dark and light high contrast", async ({ page }) => {
        const base = {
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            worldDetail: "50m",
            referenceDetail: "full",
            entities: ["USA", "CAN", "MEX"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"],
            highContrast: true,
            showLabels: false,
            showCenterProbe: false,
            showResetControl: false,
            showGestureHelp: false
        };
        expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
        for (const colors of [
            { foreground: "#ffff00", background: "#000000", selected: "#00ffff" },
            { foreground: "#000000", background: "#ffffff", selected: "#0000ff" }
        ]) {
            await mount(page, {
                ...base,
                svgFeatureThreshold: 500,
                highContrastForeground: colors.foreground,
                highContrastBackground: colors.background,
                highContrastSelected: colors.selected
            });
            const lakeFill = page.locator("[data-reference-role='water']").first();
            const lakeBoundary = page.locator("[data-reference-role='water-boundary']").first();
            await expect(lakeFill).toHaveAttribute("fill", colors.background);
            await expect(lakeFill).toHaveAttribute("stroke", "none");
            await expect(lakeBoundary).toHaveAttribute("stroke", colors.foreground);
            await expect(lakeBoundary).toHaveAttribute("stroke-width", "1");
            await expect(page.locator("[data-reference-role='river']")).toHaveCount(0);
            const lakeCandidates = await lakeBoundary.evaluate((node) => {
                const path = node as SVGPathElement;
                const matrix = path.getScreenCTM();
                const root = path.closest(".profile-lens-context")?.getBoundingClientRect();
                if (!matrix || !root) throw new Error("Lake boundary requires a screen transform.");
                const length = path.getTotalLength();
                const candidates: { x: number; y: number }[] = [];
                for (let index = 0; index <= 400; index++) {
                    const point = path.getPointAtLength(length * index / 400);
                    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
                    const x = screen.x - root.left;
                    const y = screen.y - root.top;
                    if (x >= 4 && x <= root.width - 4 && y >= 4 && y <= root.height - 4) {
                        candidates.push({ x, y });
                    }
                }
                return candidates;
            });
            expect(lakeCandidates.length).toBeGreaterThan(0);
            const svgFull = await page.locator(".profile-lens-context").screenshot();
            await mount(page, {
                ...base,
                referenceDetail: "standard",
                svgFeatureThreshold: 500,
                highContrastForeground: colors.foreground,
                highContrastBackground: colors.background,
                highContrastSelected: colors.selected
            });
            await expect(page.locator("[data-reference-role='water']")).toHaveCount(0);
            await expect(page.locator("[data-reference-role='river']")).toHaveCount(0);
            const svgStandard = await page.locator(".profile-lens-context").screenshot();
            const isolated = await isolatedLakePixel(
                page,
                svgFull,
                svgStandard,
                lakeCandidates,
                colors.foreground,
                colors.background
            );
            expect(isolated.fullForegroundDominant).toBeGreaterThan(0);
            expect(isolated.standardForegroundDominant).toBe(0);

            await mount(page, {
                ...base,
                svgFeatureThreshold: 1,
                highContrastForeground: colors.foreground,
                highContrastBackground: colors.background,
                highContrastSelected: colors.selected
            });
            const metrics = await page.locator(".profile-lens-context").evaluate((node) => ({
                ...(node as HTMLElement & {
                    __profileLensContextMetrics: {
                        canvasReferenceLineRoles: string[];
                        canvasReferenceStrokeColors: string[];
                    };
                }).__profileLensContextMetrics
            }));
            const waterIndex = metrics.canvasReferenceLineRoles.indexOf("water");
            expect(waterIndex).toBeGreaterThanOrEqual(0);
            expect(metrics.canvasReferenceLineRoles).not.toContain("river");
            expect(metrics.canvasReferenceStrokeColors[waterIndex]).toBe(colors.foreground);
            const canvasFull = await page.locator(".profile-lens-context").screenshot();
            const canvasPixels = await renderedForegroundAt(
                page,
                canvasFull,
                isolated.point,
                colors.foreground,
                colors.background
            );
            expect(canvasPixels.foregroundDominant).toBeGreaterThan(0);
            expect(canvasPixels.minimumForegroundDistance).toBeLessThan(200);
            await mount(page, {
                ...base,
                referenceDetail: "standard",
                svgFeatureThreshold: 1,
                highContrastForeground: colors.foreground,
                highContrastBackground: colors.background,
                highContrastSelected: colors.selected
            });
            const canvasStandard = await page.locator(".profile-lens-context").screenshot();
            const canvasStandardPixels = await renderedForegroundAt(
                page,
                canvasStandard,
                isolated.point,
                colors.foreground,
                colors.background
            );
            expect(canvasStandardPixels.foregroundDominant).toBe(0);
        }
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
                homeView: "fit",
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
                homeView: "fit",
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

    test("serializes and coalesces delayed A-B-A host selections", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: false,
            interactionMode: "reportSelection",
            selectionDelayMs: 100,
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const surface = page.locator(".profile-lens-context");
        await surface.focus();
        await surface.press("Enter");
        await surface.press("ArrowRight");
        await surface.press("Enter");
        await surface.press("ArrowLeft");
        await surface.press("Enter");
        const during = await page.evaluate(() => (window as unknown as {
            profileLensHost: {
                calls: {
                    select: number;
                    selectionInFlight: number;
                    maxSelectionInFlight: number;
                };
            };
        }).profileLensHost.calls);
        expect(during).toMatchObject({
            select: 1,
            selectionInFlight: 1,
            maxSelectionInFlight: 1
        });
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => (window as unknown as {
            profileLensHost: {
                calls: {
                    select: number;
                    selectionInFlight: number;
                    maxSelectionInFlight: number;
                    selectedKeys: string[];
                };
            };
        }).profileLensHost.calls);
        expect(after).toMatchObject({
            select: 1,
            selectionInFlight: 0,
            maxSelectionInFlight: 1
        });
        expect(after.selectedKeys).toHaveLength(1);
        expect(after.selectedKeys[0]).toContain("entity:0");
    });

    test("reconciles stale successful local selection from host state", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: false,
            interactionMode: "reportSelection",
            selectionDelayMs: 100,
            entities: ["Entity A", "Entity B", "Entity C"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const surface = page.locator(".profile-lens-context");
        await surface.focus();
        await surface.press("Enter");
        await surface.press("ArrowRight");
        await page.evaluate(() => {
            const scope = window as unknown as {
                profileLensHost: {
                    emitExternalSelection: (ids: unknown[]) => void;
                };
                profileLensSelectionId: (key: string) => unknown;
            };
            scope.profileLensHost.emitExternalSelection([
                scope.profileLensSelectionId("|node:entity:2")
            ]);
        });
        await page.waitForTimeout(150);

        await expect(page.locator(".profile-lens-header-title")).toHaveText("Entity B");
        await expect(page.locator("[id='context:entity:0']"))
            .toHaveAttribute("aria-selected", "true");
        await expect(page.locator("[id='context:entity:2']"))
            .toHaveAttribute("aria-selected", "false");
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: {
                calls: {
                    select: number;
                    maxSelectionInFlight: number;
                    selectedKeys: string[];
                };
            };
        }).profileLensHost.calls);
        expect(calls.select).toBe(1);
        expect(calls.maxSelectionInFlight).toBe(1);
        expect(calls.selectedKeys).toEqual([expect.stringContaining("entity:0")]);
    });

    test("external selection suppresses older wheel drag and pinch settles", async ({ page }) => {
        for (const action of ["wheel", "drag", "pinch"]) {
            await mount(page, {
                contextMode: "grid",
                navigationEnabled: true,
                interactionMode: "reportSelection",
                entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            const surface = page.locator(".profile-lens-context");
            const bounds = await surface.boundingBox();
            const before = await surface.evaluate((node) =>
                (node as HTMLElement & {
                    __profileLensContextMetrics: { moveEnds: number };
                }).__profileLensContextMetrics.moveEnds);
            if (action === "wheel") {
                await page.mouse.move(
                    (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
                    (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
                );
                await page.mouse.wheel(0, -120);
            } else if (action === "drag") {
                const x = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
                const y = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
                await page.mouse.move(x, y);
                await page.mouse.down();
                await page.mouse.move(x + 40, y, { steps: 8 });
            } else {
                await surface.evaluate((node) => {
                    const root = node as HTMLElement;
                    const bounds = root.getBoundingClientRect();
                    const fire = (type: string, id: number, x: number) => {
                        root.dispatchEvent(new PointerEvent(type, {
                            bubbles: true,
                            cancelable: true,
                            pointerId: id,
                            pointerType: "touch",
                            button: 0,
                            clientX: bounds.left + x,
                            clientY: bounds.top + bounds.height / 2
                        }));
                    };
                    fire("pointerdown", 401, bounds.width / 2 - 50);
                    fire("pointerdown", 402, bounds.width / 2 + 50);
                    fire("pointermove", 402, bounds.width / 2 + 90);
                });
            }
            const movedTransform = await page.locator(".profile-lens-context-outline-layer")
                .getAttribute("transform");
            await page.evaluate(() => {
                const scope = window as unknown as {
                    profileLensHost: {
                        emitExternalSelection: (ids: unknown[]) => void;
                    };
                    profileLensSelectionId: (key: string) => unknown;
                };
                const id = scope.profileLensSelectionId("|node:entity:2");
                scope.profileLensHost.emitExternalSelection([id]);
                scope.profileLensHost.emitExternalSelection([id]);
            });
            if (action === "drag") {
                await page.mouse.up();
            } else if (action === "pinch") {
                await surface.evaluate((node) => {
                    const root = node as HTMLElement;
                    const bounds = root.getBoundingClientRect();
                    const fire = (type: string, id: number, x: number) => {
                        root.dispatchEvent(new PointerEvent(type, {
                            bubbles: true,
                            cancelable: true,
                            pointerId: id,
                            pointerType: "touch",
                            clientX: bounds.left + x,
                            clientY: bounds.top + bounds.height / 2
                        }));
                    };
                    fire("pointerup", 402, bounds.width / 2 + 90);
                    fire("pointerup", 401, bounds.width / 2 - 50);
                });
            }
            await page.waitForTimeout(250);
            const after = await surface.evaluate((node) => ({
                moveEnds: (node as HTMLElement & {
                    __profileLensContextMetrics: { moveEnds: number };
                }).__profileLensContextMetrics.moveEnds,
                calls: (window as unknown as {
                    profileLensHost: {
                        calls: {
                            select: number;
                            selectedKeys: string[];
                        };
                    };
                }).profileLensHost.calls
            }));
            expect(after.moveEnds - before, action).toBe(0);
            expect(after.calls.select, action).toBe(0);
            expect(after.calls.selectedKeys, action)
                .toEqual([expect.stringContaining("entity:2")]);
            await expect(page.locator(".profile-lens-context-outline-layer"))
                .toHaveAttribute("transform", movedTransform ?? "");
        }
    });

    test("external selection does not swallow pressed profile or Entity clicks", async ({ page }) => {
        for (const selector of [".profile-lens-target", ".profile-lens-entity-option"]) {
            await mount(page, {
                contextMode: "none",
                interactionMode: "reportSelection",
                entities: ["Entity A", "Entity B"],
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            const target = page.locator(selector).first();
            const bounds = await target.boundingBox();
            expect(bounds).not.toBeNull();
            await page.mouse.move(
                (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
                (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
            );
            await page.mouse.down();
            await page.evaluate(() => {
                const scope = window as unknown as {
                    profileLensHost: {
                        emitExternalSelection: (ids: unknown[]) => void;
                    };
                    profileLensSelectionId: (key: string) => unknown;
                };
                scope.profileLensHost.emitExternalSelection([
                    scope.profileLensSelectionId("|node:entity:1")
                ]);
            });
            await page.mouse.up();
            expect(await page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: { select: number } };
            }).profileLensHost.calls.select), selector).toBe(1);
        }
    });

    test("lifecycle update does not swallow pressed profile or Entity clicks", async ({ page }) => {
        for (const selector of [".profile-lens-target", ".profile-lens-entity-option"]) {
            await mount(page, {
                contextMode: "none",
                interactionMode: "reportSelection",
                entities: ["Entity A", "Entity B"],
                periods: [],
                bands: ["Band 1"],
                series: [],
                profiles: ["Metric A"]
            });
            const target = page.locator(selector).first();
            const bounds = await target.boundingBox();
            await page.mouse.move(
                (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
                (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
            );
            await page.mouse.down();
            await page.evaluate(() => {
                const scope = window as unknown as {
                    profileLensDataView: unknown;
                    profileLensUpdate: (options: unknown) => void;
                };
                scope.profileLensUpdate({
                    width: 900,
                    height: 700,
                    dataViews: [scope.profileLensDataView],
                    jsonFilters: []
                });
            });
            expect(await page.evaluate(() => (window as unknown as {
                profileLensEvents: { started: number; finished: number; failed: number };
            }).profileLensEvents)).toMatchObject({
                started: 2,
                finished: 1,
                failed: 0
            });
            await page.mouse.up();
            expect(await page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: { select: number } };
            }).profileLensHost.calls.select), selector).toBe(1);
        }
    });

    test("disabled host update hard-stops a pressed Entity control", async ({ page }) => {
        await mount(page, {
            contextMode: "none",
            entities: ["Entity A", "Entity B"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const pressed = page.locator(".profile-lens-entity-option").nth(1);
        const bounds = await pressed.boundingBox();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        await page.mouse.down();
        await page.evaluate(() => {
            const scope = window as unknown as {
                profileLensDataView: unknown;
                profileLensHost: {
                    hostCapabilities: { allowInteractions: boolean };
                };
                profileLensUpdate: (value: unknown) => void;
            };
            scope.profileLensHost.hostCapabilities.allowInteractions = false;
            scope.profileLensUpdate({
                width: 1280,
                height: 620,
                dataViews: [scope.profileLensDataView],
                jsonFilters: []
            });
        });
        await page.mouse.up();
        await expect(page.locator(".profile-lens-header-title")).toHaveText("Entity A");
        await expect(page.locator('[data-entity-index="1"]'))
            .toHaveAttribute("aria-disabled", "true");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { select: number } };
        }).profileLensHost.calls.select)).toBe(0);
    });

    test("keeps model state atomic while a data update is deferred by drag", async ({ page }) => {
        const initial = {
            width: 1280,
            height: 620,
            contextMode: "grid",
            navigationEnabled: true,
            entities: [
                "Entity A", "Entity B", "Entity C",
                "Entity D", "Entity E", "Entity F",
                "Entity G", "Entity H", "Entity I"
            ],
            periods: [] as string[],
            bands: ["Band 1"],
            series: [] as string[],
            profiles: ["Metric A"]
        };
        await mount(page, initial);
        const surface = page.locator(".profile-lens-context");
        const bounds = await surface.boundingBox();
        const title = await page.locator(".profile-lens-header-title").textContent();
        const x = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
        const y = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 40, y, { steps: 8 });
        await page.evaluate((options) => {
            const scope = window as unknown as {
                buildProfileLensDataView: (value: unknown) => unknown;
                profileLensUpdate: (value: unknown) => void;
                profileLensDataView: unknown;
            };
            scope.profileLensUpdate({
                width: options.width,
                height: options.height,
                dataViews: [scope.buildProfileLensDataView({
                    ...options,
                    entities: ["Entity A"]
                })],
                jsonFilters: []
            });
        }, initial);
        await expect(page.locator(".profile-lens-header-title")).toHaveText(title ?? "");
        expect((await page.locator(".profile-lens-header-subtitle").allTextContents()).join(" "))
            .not.toContain("not loaded");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensEvents: { started: number; finished: number };
        }).profileLensEvents)).toMatchObject({ started: 2, finished: 1 });
        await page.mouse.up();
        await page.waitForTimeout(20);
        expect(await page.evaluate(() => (window as unknown as {
            profileLensEvents: { started: number; finished: number };
        }).profileLensEvents)).toMatchObject({ started: 2, finished: 2 });
    });

    test("preserves deferred data through a later lifecycle-only update", async ({ page }) => {
        const initial = {
            width: 1280,
            height: 620,
            contextMode: "grid",
            navigationEnabled: true,
            entities: ["Entity A", "Entity B"],
            periods: [] as string[],
            bands: ["Band 1"],
            series: [] as string[],
            profiles: ["Metric A"]
        };
        await mount(page, initial);
        const surface = page.locator(".profile-lens-context");
        const bounds = await surface.boundingBox();
        const x = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
        const y = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 40, y, { steps: 8 });
        await page.evaluate((options) => {
            const scope = window as unknown as {
                buildProfileLensDataView: (value: unknown) => unknown;
                profileLensUpdate: (value: unknown) => void;
                profileLensDataView: unknown;
            };
            scope.profileLensUpdate({
                width: options.width,
                height: options.height,
                dataViews: [scope.buildProfileLensDataView({
                    ...options,
                    entities: ["Replacement"]
                })],
                jsonFilters: []
            });
            const committed = scope.profileLensDataView as {
                metadata: {
                    objects: {
                        context: { mode: string };
                    };
                };
            };
            committed.metadata.objects.context.mode = "none";
            scope.profileLensUpdate({
                width: 1000,
                height: 800,
                dataViews: [scope.profileLensDataView],
                jsonFilters: []
            });
        }, initial);
        expect(await page.evaluate(() => (window as unknown as {
            profileLensEvents: { started: number; finished: number };
        }).profileLensEvents)).toMatchObject({ started: 3, finished: 1 });
        await page.mouse.up();
        await page.waitForTimeout(20);
        await expect(page.locator(".profile-lens-header-title")).toHaveText("Replacement");
        await expect(page.locator(".profile-lens-context")).toBeHidden();
        expect(await page.evaluate(() => (window as unknown as {
            profileLensEvents: { started: number; finished: number; failed: number };
        }).profileLensEvents)).toMatchObject({ started: 3, finished: 3, failed: 0 });
    });

    test("preserves deferred append semantics when resize resends pending DataView", async ({ page }) => {
        const initial = {
            width: 1280,
            height: 620,
            contextMode: "none",
            segment: true,
            entities: ["Entity A"],
            periods: [] as string[],
            bands: ["Band 1"],
            series: [] as string[],
            profiles: ["Metric A"]
        };
        await mount(page, initial);
        const target = page.locator(".profile-lens-target").first();
        const bounds = await target.boundingBox();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        await page.mouse.down();
        await page.evaluate((options) => {
            const scope = window as unknown as {
                buildProfileLensDataView: (value: unknown) => unknown;
                profileLensUpdate: (value: unknown) => void;
                profileLensDataView: unknown;
            };
            const appended = scope.buildProfileLensDataView(options);
            scope.profileLensDataView = appended;
            scope.profileLensUpdate({
                width: 900,
                height: 700,
                dataViews: [appended],
                operationKind: 1,
                jsonFilters: []
            });
            scope.profileLensUpdate({
                width: 1000,
                height: 800,
                dataViews: [appended],
                jsonFilters: []
            });
        }, initial);
        await page.mouse.up();
        await page.waitForTimeout(20);
        await expect(page.locator('[data-code="partialData"]')).toContainText("2 segments");
        await page.evaluate(() => {
            const scope = window as unknown as {
                profileLensDataView: unknown;
                profileLensUpdate: (value: unknown) => void;
            };
            scope.profileLensUpdate({
                width: 1100,
                height: 850,
                dataViews: [scope.profileLensDataView],
                jsonFilters: []
            });
        });
        await expect(page.locator('[data-code="partialData"]')).toContainText("2 segments");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensEvents: { started: number; finished: number; failed: number };
        }).profileLensEvents)).toMatchObject({ started: 4, finished: 4, failed: 0 });
    });

    test("host update supersedes wheel before external selection", async ({ page }) => {
        const initial = {
            width: 1280,
            height: 620,
            contextMode: "grid",
            navigationEnabled: true,
            entities: ["Entity A", "Entity B"],
            periods: [] as string[],
            bands: ["Band 1"],
            series: [] as string[],
            profiles: ["Metric A"]
        };
        await mount(page, initial);
        const surface = page.locator(".profile-lens-context");
        const bounds = await surface.boundingBox();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        await page.mouse.wheel(0, -120);
        await page.evaluate((options) => {
            const scope = window as unknown as {
                buildProfileLensDataView: (value: unknown) => unknown;
                profileLensUpdate: (value: unknown) => void;
                profileLensHost: {
                    emitExternalSelection: (ids: unknown[]) => void;
                };
                profileLensSelectionId: (key: string) => unknown;
            };
            scope.profileLensUpdate({
                width: options.width,
                height: options.height,
                dataViews: [scope.buildProfileLensDataView({
                    ...options,
                    entities: ["Replacement"]
                })],
                jsonFilters: []
            });
            scope.profileLensHost.emitExternalSelection([
                scope.profileLensSelectionId("|node:entity:0")
            ]);
        }, initial);
        await expect(page.locator(".profile-lens-header-title")).toHaveText("Replacement");
        await page.waitForTimeout(250);
        const result = await surface.evaluate((node) => ({
            moveEnds: (node as HTMLElement & {
                __profileLensContextMetrics: { moveEnds: number };
            }).__profileLensContextMetrics.moveEnds,
            calls: (window as unknown as {
                profileLensHost: { calls: { select: number } };
            }).profileLensHost.calls,
            events: (window as unknown as {
                profileLensEvents: { started: number; finished: number; failed: number };
            }).profileLensEvents
        }));
        expect(result).toMatchObject({
            moveEnds: 0,
            calls: { select: 0 },
            events: { started: 2, finished: 2, failed: 0 }
        });
    });

    test("preserves Context click before a deferred empty update", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: true,
            interactionMode: "reportSelection",
            entities: ["Entity A", "Entity B"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const feature = page.locator("[data-context-key='entity:0']");
        const bounds = await feature.boundingBox();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        await page.mouse.down();
        await page.evaluate(() => {
            const scope = window as unknown as {
                buildProfileLensDataView: (value: unknown) => unknown;
                profileLensUpdate: (value: unknown) => void;
            };
            scope.profileLensUpdate({
                width: 1280,
                height: 620,
                dataViews: [scope.buildProfileLensDataView({
                    contextMode: "none",
                    entities: [],
                    periods: [],
                    bands: [],
                    series: [],
                    profiles: []
                })],
                jsonFilters: []
            });
        });
        await expect(page.locator(".profile-lens-context")).toBeVisible();
        await page.mouse.up();
        await page.waitForTimeout(20);
        expect(await page.evaluate(() => ({
            select: (window as unknown as {
                profileLensHost: { calls: { select: number } };
            }).profileLensHost.calls.select,
            events: (window as unknown as {
                profileLensEvents: { started: number; finished: number };
            }).profileLensEvents
        }))).toMatchObject({
            select: 1,
            events: { started: 2, finished: 2 }
        });
        await expect(page.locator(".profile-lens-landing")).toBeVisible();
    });

    test("flushes external selection after pointer release outside the visual", async ({ page }) => {
        await mount(page, {
            width: 640,
            height: 300,
            contextMode: "none",
            entities: ["Entity A"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const target = page.locator(".profile-lens-target").first();
        const bounds = await target.boundingBox();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        await page.mouse.down();
        await page.evaluate(() => {
            const scope = window as unknown as {
                profileLensHost: {
                    emitExternalSelection: (ids: unknown[]) => void;
                };
                profileLensSelectionId: (key: string) => unknown;
            };
            scope.profileLensHost.emitExternalSelection([
                scope.profileLensSelectionId("|node:band:0:-1:0")
            ]);
        });
        await page.mouse.move(1000, 500);
        await page.mouse.up();
        await expect(page.locator(".profile-lens-target").first())
            .toHaveAttribute("aria-pressed", "true");
    });

    test("flushes delayed selection when a no-change wheel settles", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: true,
            minZoom: 7.3,
            maxZoom: 7.3,
            selectionDelayMs: 50,
            entities: ["Entity A", "Entity B"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const target = page.locator(".profile-lens-target").first();
        await target.click();
        const surface = page.locator(".profile-lens-context");
        const bounds = await surface.boundingBox();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(150);
        await expect(page.locator(".profile-lens-target").first())
            .toHaveAttribute("aria-pressed", "true");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: {
                calls: {
                    select: number;
                    maxSelectionInFlight: number;
                };
            };
        }).profileLensHost.calls)).toMatchObject({
            select: 1,
            maxSelectionInFlight: 1
        });
    });

    test("flushes delayed selection when keyboard cancels wheel settle", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: true,
            minZoom: 7.3,
            maxZoom: 7.3,
            selectionDelayMs: 50,
            entities: ["Entity A", "Entity B"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        await page.locator(".profile-lens-target").first().click();
        const surface = page.locator(".profile-lens-context");
        const bounds = await surface.boundingBox();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(75);
        await surface.focus();
        await surface.press("Escape");
        await expect(page.locator(".profile-lens-target").first())
            .toHaveAttribute("aria-pressed", "true");
        await page.waitForTimeout(100);
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: {
                calls: {
                    select: number;
                    maxSelectionInFlight: number;
                };
            };
        }).profileLensHost.calls)).toMatchObject({
            select: 1,
            maxSelectionInFlight: 1
        });
    });

    test("host update supersedes wheel while local selection is pending", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: true,
            minZoom: 7.3,
            maxZoom: 7.3,
            selectionDelayMs: 50,
            entities: ["Entity A", "Entity B"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const beforeWidth = await page.locator(".profile-lens-profile-svg").getAttribute("width");
        await page.locator(".profile-lens-target").first().click();
        const surface = page.locator(".profile-lens-context");
        const bounds = await surface.boundingBox();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        await page.mouse.wheel(0, -120);
        await page.evaluate(() => {
            const scope = window as unknown as {
                profileLensDataView: unknown;
                profileLensUpdate: (options: unknown) => void;
            };
            scope.profileLensUpdate({
                width: 900,
                height: 700,
                dataViews: [scope.profileLensDataView],
                jsonFilters: []
            });
        });
        await page.waitForTimeout(75);
        expect(await page.evaluate(() => (window as unknown as {
            profileLensEvents: { finished: number };
        }).profileLensEvents.finished)).toBe(2);
        await expect(page.locator(".profile-lens-profile-svg"))
            .not.toHaveAttribute("width", beforeWidth ?? "");
        await page.waitForTimeout(75);
        expect(await page.evaluate(() => (window as unknown as {
            profileLensEvents: { finished: number };
        }).profileLensEvents.finished)).toBe(2);
        await expect(page.locator(".profile-lens-profile-svg"))
            .not.toHaveAttribute("width", beforeWidth ?? "");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { select: number } };
        }).profileLensHost.calls.select)).toBe(1);
    });

    test("keyboard activates replacement target after host update cancels wheel", async ({ page }) => {
        const initial = {
            width: 1280,
            height: 620,
            contextMode: "grid",
            navigationEnabled: true,
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            periods: [] as string[],
            bands: ["Band 1"],
            series: [] as string[],
            profiles: ["Metric A"]
        };
        await mount(page, initial);
        const surface = page.locator(".profile-lens-context");
        const bounds = await surface.boundingBox();
        await page.mouse.move(
            (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2,
            (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2
        );
        await page.mouse.wheel(0, -120);
        await page.evaluate((options) => {
            const scope = window as unknown as {
                buildProfileLensDataView: (value: unknown) => unknown;
                profileLensUpdate: (value: unknown) => void;
            };
            scope.profileLensUpdate({
                width: options.width,
                height: options.height,
                dataViews: [scope.buildProfileLensDataView({
                    ...options,
                    entities: ["Replacement"]
                })],
                jsonFilters: []
            });
        }, initial);
        const target = page.locator(".profile-lens-target").first();
        await target.focus();
        await target.press("Enter");
        await expect(page.locator(".profile-lens-header-title")).toHaveText("Replacement");
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: {
                calls: {
                    select: number;
                    lastSelectedKey: string | null;
                };
            };
        }).profileLensHost.calls);
        expect(calls.select).toBe(1);
        expect(calls.lastSelectedKey).toContain("band:0:-1:0");
    });

    test("profile press survives canceling a pending wheel settle", async ({ page }) => {
        await mount(page, {
            contextMode: "grid",
            navigationEnabled: true,
            minZoom: 7.3,
            maxZoom: 7.3,
            selectionDelayMs: 50,
            entities: ["Entity A", "Entity B"],
            periods: [],
            bands: ["Band 1", "Band 2"],
            series: [],
            profiles: ["Metric A"]
        });
        const targets = page.locator(".profile-lens-target");
        await targets.first().click();
        const surface = page.locator(".profile-lens-context");
        const surfaceBounds = await surface.boundingBox();
        await page.mouse.move(
            (surfaceBounds?.x ?? 0) + (surfaceBounds?.width ?? 0) / 2,
            (surfaceBounds?.y ?? 0) + (surfaceBounds?.height ?? 0) / 2
        );
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(75);
        const targetBounds = await targets.nth(1).boundingBox();
        await page.mouse.move(
            (targetBounds?.x ?? 0) + (targetBounds?.width ?? 0) / 2,
            (targetBounds?.y ?? 0) + (targetBounds?.height ?? 0) / 2
        );
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(75);
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: {
                calls: {
                    select: number;
                    maxSelectionInFlight: number;
                };
            };
        }).profileLensHost.calls);
        expect(calls).toMatchObject({
            select: 2,
            maxSelectionInFlight: 1
        });
    });

    test("ignores deferred selection completion after visual destroy", async ({ page }) => {
        await mount(page, {
            contextMode: "none",
            selectionDelayMs: 100,
            entities: ["Entity A", "Entity B"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const target = page.locator(".profile-lens-target").first();
        await target.click();
        await page.evaluate(() => {
            (window as unknown as {
                profileLensInstance: { destroy: () => void };
            }).profileLensInstance.destroy();
        });
        await page.waitForTimeout(150);
        await page.locator(".profile-lens").dispatchEvent("contextmenu", {
            clientX: 5,
            clientY: 5
        });
        await target.click({ force: true });
        await page.locator(".profile-lens-entity-option").first().click({ force: true });
        await page.locator(".profile-lens").dispatchEvent("contextmenu", {
            clientX: 5,
            clientY: 5
        });
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: {
                calls: {
                    select: number;
                    contextMenu: number;
                    selectionInFlight: number;
                    maxSelectionInFlight: number;
                };
            };
        }).profileLensHost.calls);
        expect(calls).toMatchObject({
            select: 1,
            contextMenu: 0,
            selectionInFlight: 0,
            maxSelectionInFlight: 1
        });
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
            const selectionsBeforeActivation = await page.evaluate(() =>
                (window as unknown as {
                    profileLensHost: { calls: { select: number } };
                }).profileLensHost.calls.select);

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
            expect(calls.select).toBe(selectionsBeforeActivation + 1);
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
            const afterReset = await page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: { select: number; contextMenu: number } };
            }).profileLensHost.calls);
            expect(afterReset.select - calls.select).toBeLessThanOrEqual(1);
            expect(afterReset.contextMenu).toBe(1);
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
            const afterTouch = await page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: { select: number; contextMenu: number } };
            }).profileLensHost.calls);
            expect(afterTouch.select - afterReset.select).toBeLessThanOrEqual(1);
            expect(afterTouch.contextMenu).toBe(1);
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

    test("keeps exact fallback separate from a known no-data backdrop feature", async ({ page }) => {
        await mount(page, {
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            packKeyMode: "canonical",
            fallbackEntityKey: "WLD",
            // This test is about fallback versus no-data backdrop semantics, so Home is pinned to
            // the scene centre and the assertions stay independent of data-bearing Home placement.
            homeFocus: "sceneCenter",
            entities: ["WLD", "USA"],
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        await expect(page.locator(".profile-lens-header-title")).toHaveText("WLD");
        await expect(page.locator(".profile-lens-header-subtitle"))
            .toContainText("configured fallback");
        expect(await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { select: number } };
        }).profileLensHost.calls.select)).toBe(0);

        const feature = await page.locator("[data-context-key='AFG']").boundingBox();
        expect(feature).not.toBeNull();
        const x = (feature?.x ?? 0) + (feature?.width ?? 0) / 2;
        const y = (feature?.y ?? 0) + (feature?.height ?? 0) / 2;
        await page.mouse.click(x, y);
        await expect(page.locator(".profile-lens-header-title")).toHaveText("Afghanistan");
        await expect(page.locator(".profile-lens-header-subtitle"))
            .toContainText("No data in current report context");
        await expect(page.locator(".profile-lens-table"))
            .toContainText("No data in current report context");
        const calls = await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { select: number; filter: number } };
        }).profileLensHost.calls);
        expect(calls).toMatchObject({ select: 0, filter: 0 });
    });

    test("keeps overscanned Canvas point pixels and picking aligned after camera movement", async ({ page }) => {
        await mount(page, {
            contextMode: "boundGeometry",
            homeView: "fit",
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

    test("supports isolated vertical drag from Automatic Fill home for world, state, and county", async ({ page }) => {
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
                entities: COUNTY_KEYS.filter((_key, index) => index % 17 === 0),
                svgFeatureThreshold: 1,
                svgVertexThreshold: 100
            }
        ];
        for (const value of cases) {
            await mount(page, {
                width: 1280,
                height: 620,
                contextMode: "builtInPack",
                contextLayout: "focusLens",
                navigationMode: "auto",
                homeView: "automatic",
                interactionMode: "localOnly",
                contextPack: value.contextPack,
                worldDetail: value.worldDetail,
                packKeyMode: value.packKeyMode,
                svgFeatureThreshold: value.svgFeatureThreshold,
                svgVertexThreshold: value.svgVertexThreshold,
                entities: value.entities,
                periods: ["Period 1", "Period 2"],
                bands: ["Band 1", "Band 2", "Band 3", "Band 4", "Band 5"],
                series: ["Series X", "Series Y"],
                profiles: ["Metric A", "Metric B", "Metric C"]
            });
            const surface = page.locator(".profile-lens-context");
            await expect(surface).toHaveCSS("touch-action", "none");
            const bounds = await surface.boundingBox();
            expect(bounds).not.toBeNull();
            const before = await surface.evaluate((node) => {
                const metrics = (node as HTMLElement & {
                    __profileLensContextMetrics: {
                        homeZoom: number;
                        cameraZoom: number;
                        panX: number;
                        panY: number;
                        moveEnds: number;
                        probeTransitions: number;
                        providerBuilds: number;
                        sceneBuilds: number;
                        sceneIndexBuilds: number;
                        svgGeometryBuilds: number;
                        canvasRasterBuilds: number;
                        canvasPickingBuilds: number;
                    };
                }).__profileLensContextMetrics;
                return { ...metrics };
            });
            expect(before.homeZoom, value.name).toBeGreaterThan(1);
            expect(before.cameraZoom, value.name).toBeCloseTo(before.homeZoom, 10);
            const centerX = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
            const centerY = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
            await page.mouse.move(centerX, centerY);
            await page.mouse.down();
            await page.mouse.move(centerX, centerY + 120, { steps: 12 });
            await page.mouse.up();
            const after = await surface.evaluate((node) => {
                const metrics = (node as HTMLElement & {
                    __profileLensContextMetrics: {
                        cameraZoom: number;
                        panX: number;
                        panY: number;
                        moveEnds: number;
                        probeTransitions: number;
                        providerBuilds: number;
                        sceneBuilds: number;
                        sceneIndexBuilds: number;
                        svgGeometryBuilds: number;
                        canvasRasterBuilds: number;
                        canvasPickingBuilds: number;
                    };
                }).__profileLensContextMetrics;
                return { ...metrics };
            });
            expect(Math.abs(after.panY - before.panY), value.name).toBeGreaterThan(10);
            expect(Math.abs(after.panX - before.panX), value.name).toBeLessThanOrEqual(0.5);
            expect(after.probeTransitions - before.probeTransitions, value.name)
                .toBeGreaterThan(0);
            expect(after.moveEnds - before.moveEnds, value.name).toBe(1);
            expect(after.providerBuilds - before.providerBuilds, value.name).toBe(0);
            expect(after.sceneBuilds - before.sceneBuilds, value.name).toBe(0);
            expect(after.sceneIndexBuilds - before.sceneIndexBuilds, value.name).toBe(0);
            expect(after.svgGeometryBuilds - before.svgGeometryBuilds, value.name).toBe(0);
            expect(after.canvasRasterBuilds - before.canvasRasterBuilds, value.name).toBe(0);
            expect(after.canvasPickingBuilds - before.canvasPickingBuilds, value.name).toBe(0);
            expect(await page.evaluate(() => (window as unknown as {
                profileLensHost: { calls: { select: number } };
            }).profileLensHost.calls.select), value.name).toBe(0);
        }
    });

    test("keeps fitted minimum reachable and Home returns to the fill camera", async ({ page }) => {
        await mount(page, {
            contextMode: "builtInPack",
            contextLayout: "focusLens",
            contextPack: "worldCountries",
            worldDetail: "50m",
            packKeyMode: "canonical",
            homeView: "fill",
            entities: WORLD_50_KEYS,
            periods: [],
            bands: ["Band 1"],
            series: [],
            profiles: ["Metric A"]
        });
        const surface = page.locator(".profile-lens-context");
        await surface.focus();
        const initial = await surface.evaluate((node) => {
            const metrics = (node as HTMLElement & {
                __profileLensContextMetrics: {
                    homeZoom: number;
                    cameraZoom: number;
                    panX: number;
                    panY: number;
                };
            }).__profileLensContextMetrics;
            return { ...metrics };
        });
        for (let index = 0; index < 20; index++) {
            await surface.press("-");
        }
        const fitted = await surface.evaluate((node) => ({
            ...(node as HTMLElement & {
                __profileLensContextMetrics: {
                    cameraZoom: number;
                    panX: number;
                    panY: number;
                };
            }).__profileLensContextMetrics
        }));
        expect(fitted.cameraZoom).toBe(1);
        await surface.press("Home");
        const reset = await surface.evaluate((node) => ({
            ...(node as HTMLElement & {
                __profileLensContextMetrics: {
                    cameraZoom: number;
                    panX: number;
                    panY: number;
                };
            }).__profileLensContextMetrics
        }));
        expect(reset.cameraZoom).toBeCloseTo(initial.homeZoom, 10);
        expect(reset.panX).toBeCloseTo(initial.panX, 10);
        expect(reset.panY).toBeCloseTo(initial.panY, 10);
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
                entities: STATE_KEYS.filter((_key, index) => index % 2 === 0),
                svgFeatureThreshold: 500,
                svgVertexThreshold: 100000
            },
            {
                name: "county",
                contextPack: "usCounties",
                packKeyMode: "geoid5",
                entities: COUNTY_KEYS.filter((_key, index) => index % 17 === 0),
                svgFeatureThreshold: 1,
                svgVertexThreshold: 100
            }
        ];
        const observed: Array<Record<string, unknown>> = [];
        for (const value of cases) {
            await mount(page, {
                contextMode: "builtInPack",
                navigationEnabled: true,
                interactionMode: "localOnly",
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
                        providerBuilds: number;
                        sceneBuilds: number;
                        sceneIndexBuilds: number;
                        sceneBuildDurationMs: number;
                        svgGeometryBuilds: number;
                        svgGeometryBuildDurationMs: number;
                        canvasRasterBuilds: number;
                        canvasRasterBuildDurationMs: number;
                        canvasPickingBuilds: number;
                        canvasPickingBuildDurationMs: number;
                        canvasCameraDraws: number;
                        cameraFrames: number;
                        moveEnds: number;
                        probeResolutions: number;
                        probeTransitions: number;
                        probeResolveDurationsMs: number[];
                        profilePartialUpdates: number;
                        profilePartialDurationsMs: number[];
                        cameraFrameDurationsMs: number[];
                    };
                }).__profileLensContextMetrics;
                if (!metrics) throw new Error("context metrics are missing");
                return { ...metrics, cameraFrameDurationsMs: [...metrics.cameraFrameDurationsMs] };
            });
            const centerX = (bounds?.x ?? 0) + (bounds?.width ?? 0) / 2;
            const centerY = (bounds?.y ?? 0) + (bounds?.height ?? 0) / 2;
            await page.mouse.move(
                centerX - (bounds?.width ?? 0) * 0.25,
                centerY - (bounds?.height ?? 0) * 0.1
            );
            for (let index = 0; index < 3; index++) {
                await page.mouse.wheel(0, -80);
            }
            await page.waitForTimeout(150);
            const svgTargets = value.name === "world"
                ? ["BRA", "USA"]
                : value.name === "state"
                    ? ["06", "48"]
                    : [];
            for (const featureKey of svgTargets) {
                    const featureBounds = await page.locator(
                        `[data-context-key='${featureKey}']`
                    ).boundingBox();
                    expect(featureBounds).not.toBeNull();
                    const featureX = (featureBounds?.x ?? 0) + (featureBounds?.width ?? 0) / 2;
                    const featureY = (featureBounds?.y ?? 0) + (featureBounds?.height ?? 0) / 2;
                    await page.mouse.move(centerX, centerY);
                    await page.mouse.down();
                    await page.mouse.move(
                        centerX + centerX - featureX,
                        centerY + centerY - featureY,
                        { steps: 12 }
                    );
                    await page.mouse.up();
            }
            await page.mouse.move(centerX, centerY);
            await page.mouse.down();
            await page.mouse.move(centerX - 80, centerY + 24, { steps: 20 });
            await page.mouse.up();
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
                        providerBuilds: number;
                        sceneBuilds: number;
                        sceneIndexBuilds: number;
                        sceneBuildDurationMs: number;
                        svgGeometryBuilds: number;
                        svgGeometryBuildDurationMs: number;
                        canvasRasterBuilds: number;
                        canvasRasterBuildDurationMs: number;
                        canvasPickingBuilds: number;
                        canvasPickingBuildDurationMs: number;
                        canvasCameraDraws: number;
                        cameraFrames: number;
                        moveEnds: number;
                        maxCameraFrameDurationMs: number;
                        cameraFrameDurationsMs: number[];
                        probeResolutions: number;
                        probeTransitions: number;
                        probeResolveDurationsMs: number[];
                        profilePartialUpdates: number;
                        profilePartialDurationsMs: number[];
                    };
                }).__profileLensContextMetrics;
                if (!metrics) throw new Error("context metrics are missing");
                return { ...metrics, cameraFrameDurationsMs: [...metrics.cameraFrameDurationsMs] };
            });
            expect(after.providerBuilds).toBe(before.providerBuilds);
            expect(after.sceneBuilds).toBe(before.sceneBuilds);
            expect(after.sceneIndexBuilds).toBe(before.sceneIndexBuilds);
            expect(after.svgGeometryBuilds).toBe(before.svgGeometryBuilds);
            expect(after.canvasRasterBuilds).toBe(before.canvasRasterBuilds);
            expect(after.canvasPickingBuilds).toBe(before.canvasPickingBuilds);
            const frameDelta = after.cameraFrames - before.cameraFrames;
            const canvasDrawDelta = after.canvasCameraDraws - before.canvasCameraDraws;
            expect(canvasDrawDelta).toBe(after.canvasRasterBuilds > 0 ? frameDelta : 0);
            expect(frameDelta).toBeGreaterThanOrEqual(15);
            const moveEndDelta = after.moveEnds - before.moveEnds;
            expect(moveEndDelta).toBeGreaterThanOrEqual(2);
            expect(moveEndDelta).toBeLessThanOrEqual(6);
            const probeTransitionDelta = after.probeTransitions - before.probeTransitions;
            const profilePartialDelta =
                after.profilePartialUpdates - before.profilePartialUpdates;
            expect(probeTransitionDelta, value.name).toBeGreaterThan(0);
            expect(profilePartialDelta).toBe(probeTransitionDelta);
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
            const probeDurations = after.probeResolveDurationsMs
                .slice(-(after.probeResolutions - before.probeResolutions))
                .sort((left, right) => left - right);
            const probeP95 = probeDurations[
                Math.floor((probeDurations.length - 1) * 0.95)
            ] ?? Number.POSITIVE_INFINITY;
            const probeMax = probeDurations.at(-1) ?? Number.POSITIVE_INFINITY;
            expect(probeP95).toBeLessThanOrEqual(4);
            expect(probeMax).toBeLessThanOrEqual(8);
            const partialDurations = profilePartialDelta === 0
                ? []
                : after.profilePartialDurationsMs
                    .slice(-profilePartialDelta)
                    .sort((left, right) => left - right);
            const partialP95 = partialDurations.length === 0
                ? 0
                : partialDurations[
                    Math.floor((partialDurations.length - 1) * 0.95)
                ] ?? Number.POSITIVE_INFINITY;
            const partialMax = partialDurations.at(-1) ?? 0;
            expect(partialP95).toBeLessThanOrEqual(16.7);
            expect(partialMax).toBeLessThanOrEqual(33.4);
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
                probeTransitionDelta,
                profilePartialDelta,
                probeP95,
                probeMax,
                partialP95,
                partialMax,
                providerBuilds: after.providerBuilds,
                sceneBuilds: after.sceneBuilds,
                sceneIndexBuilds: after.sceneIndexBuilds,
                sceneBuildDurationMs: after.sceneBuildDurationMs,
                svgGeometryBuilds: after.svgGeometryBuilds,
                svgGeometryBuildDurationMs: after.svgGeometryBuildDurationMs,
                canvasRasterBuilds: after.canvasRasterBuilds,
                canvasRasterBuildDurationMs: after.canvasRasterBuildDurationMs,
                canvasPickingBuilds: after.canvasPickingBuilds,
                canvasPickingBuildDurationMs: after.canvasPickingBuildDurationMs,
                canvasCameraDraws: after.canvasCameraDraws
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

/**
 * Chart design probes.
 *
 * Every assertion here corresponds to a defect the packaged v1.8 bundle actually rendered in
 * Chromium: labels on one arm out of six, labels at the far edge of the value budget, an
 * unreadable label run at 490x390, no numbers anywhere, and a chart drawn over an undimmed map with
 * no containment.
 */
test.describe("packaged chart design", () => {
    const CHART_LABEL_SELECTOR = ".profile-lens-label-layer .profile-lens-chart-label";

    async function labelBoxes(page: Page): Promise<Array<{
        kind: string;
        key: string;
        text: string;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    }>> {
        return page.evaluate((selector) => [...document.querySelectorAll(selector)]
            .map((node) => {
                const box = (node as SVGGraphicsElement).getBBox();
                return {
                    kind: node.getAttribute("data-label-kind") ?? "",
                    key: node.getAttribute("data-label-key") ?? "",
                    text: node.textContent ?? "",
                    x1: box.x,
                    y1: box.y,
                    x2: box.x + box.width,
                    y2: box.y + box.height
                };
            }), CHART_LABEL_SELECTOR);
    }

    test("labels every arm and keeps band labels beside their bands", async ({ page }) => {
        await mount(page, {
            width: 1280,
            height: 620,
            entities: ["Entity A"],
            periods: [],
            series: [],
            bands: ["0 to 17", "18 to 34", "35 to 49", "50 to 64", "65 and over"],
            profiles: ["Residents", "Median income", "Degree holders", "Labor force"]
        });
        const labels = await labelBoxes(page);
        const arms = new Set(labels
            .filter((label) => label.kind === "band")
            .map((label) => label.key.split(":")[1]));
        // v1.8 drew band labels for arm 0 only.
        expect([...arms].sort()).toEqual(["0", "1", "2", "3"]);
        expect(labels.filter((label) => label.kind === "caption")).toHaveLength(4);

        const geometry = await page.evaluate(() => [...document.querySelectorAll(".profile-lens-arm")]
            .map((arm) => {
                const rects = [...arm.querySelectorAll("rect")];
                const boxes = rects.map((rect) => (rect as SVGGraphicsElement).getBoundingClientRect());
                return {
                    index: arm.getAttribute("data-profile-index") ?? "",
                    left: Math.min(...boxes.map((box) => box.left)),
                    right: Math.max(...boxes.map((box) => box.right)),
                    top: Math.min(...boxes.map((box) => box.top)),
                    bottom: Math.max(...boxes.map((box) => box.bottom))
                };
            }));
        const screenLabels = await page.evaluate((selector) =>
            [...document.querySelectorAll(selector)]
                .filter((node) => node.getAttribute("data-label-kind") === "band")
                .map((node) => {
                    const box = node.getBoundingClientRect();
                    return {
                        index: (node.getAttribute("data-label-key") ?? "").split(":")[1],
                        x: (box.left + box.right) / 2,
                        y: (box.top + box.bottom) / 2
                    };
                }), CHART_LABEL_SELECTOR);
        for (const label of screenLabels) {
            const arm = geometry.find((entry) => entry.index === label.index)!;
            const distance = Math.max(
                arm.left - label.x,
                label.x - arm.right,
                arm.top - label.y,
                label.y - arm.bottom,
                0
            );
            // v1.8 placed these at valueExtent + 8, roughly 350px from the bars on a tall arm.
            expect(distance, `${label.index} band label drifted from its arm`).toBeLessThan(60);
        }
    });

    test("shows values and a per-arm scale annotation at the full tier", async ({ page }) => {
        await mount(page, { width: 1280, height: 620, entities: ["Entity A"], periods: [] });
        const labels = await labelBoxes(page);
        expect(labels.filter((label) => label.kind === "value").length).toBeGreaterThan(0);
        const scales = labels.filter((label) => label.kind === "scale");
        expect(scales).toHaveLength(3);
        for (const scale of scales) {
            expect(scale.text).toMatch(/^Max /);
        }

        await mount(page, {
            width: 1280,
            height: 620,
            entities: ["Entity A"],
            periods: [],
            normalization: "shareOfProfile"
        });
        const proportional = await labelBoxes(page);
        for (const scale of proportional.filter((label) => label.kind === "scale")) {
            // A proportional maximum is meaningless without the unit that defines it.
            expect(scale.text).toContain("Share of profile");
        }
    });

    test("keeps a persisted decision to hide values", async ({ page }) => {
        await mount(page, {
            width: 1280,
            height: 620,
            entities: ["Entity A"],
            periods: [],
            showValueLabels: false
        });
        const labels = await labelBoxes(page);
        expect(labels.filter((label) => label.kind === "value")).toHaveLength(0);
        expect(await page.locator(".profile-lens-target").count()).toBeGreaterThan(0);
    });

    test("never overlaps two chart labels, down to an 80x80 tile", async ({ page }) => {
        const observed: Array<{ size: string; labels: number; cap: string | null }> = [];
        for (const size of [
            { width: 1280, height: 620 },
            { width: 760, height: 560 },
            { width: 490, height: 390 },
            { width: 258, height: 198 },
            { width: 178, height: 138 },
            { width: 80, height: 80 }
        ]) {
            await mount(page, {
                width: size.width,
                height: size.height,
                entities: ["Entity A"],
                periods: [],
                bands: ["0 to 17", "18 to 34", "35 to 49", "50 to 64", "65 and over"],
                profiles: ["Residents", "Median household income"]
            });
            const label = `${size.width}x${size.height}`;
            const boxes = await labelBoxes(page);
            const cap = await page.locator(".profile-lens-label-layer").first()
                .getAttribute("data-label-cap");
            observed.push({ size: label, labels: boxes.length, cap });
            expect(boxes.length, `${label} exceeded its cap`)
                .toBeLessThanOrEqual(Number(cap ?? 0));
            for (let left = 0; left < boxes.length; left++) {
                for (let right = left + 1; right < boxes.length; right++) {
                    const a = boxes[left];
                    const b = boxes[right];
                    const overlaps = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
                    // v1.8 rendered "Band 5Band 4Band 3Band 2Band 1" as one run at 490x390.
                    expect(overlaps, `${label}: "${a.text}" over "${b.text}"`).toBe(false);
                }
            }
            const chart = await page.locator("svg.profile-lens-profile-svg").first().boundingBox();
            for (const box of await page.evaluate((selector) =>
                [...document.querySelectorAll(selector)]
                    .map((node) => node.getBoundingClientRect())
                    .map((rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })),
            CHART_LABEL_SELECTOR)) {
                expect(box.left, `${label} label escaped left`).toBeGreaterThanOrEqual(chart!.x - 1);
                expect(box.right, `${label} label escaped right`)
                    .toBeLessThanOrEqual(chart!.x + chart!.width + 1);
                expect(box.top, `${label} label escaped top`).toBeGreaterThanOrEqual(chart!.y - 1);
                expect(box.bottom, `${label} label escaped bottom`)
                    .toBeLessThanOrEqual(chart!.y + chart!.height + 1);
            }
        }
        expect(observed.at(-1)!.labels).toBe(0);
        console.log(`Chart label placement: ${JSON.stringify(observed)}`);
        expect(externalRequests).toEqual([]);
    });

    test("contains the focus lens and keeps the treatment out of picking and semantics", async ({ page }) => {
        await mount(page, {
            width: 1280,
            height: 620,
            entities: [...WORLD_50_KEYS.slice(0, 24)],
            periods: [],
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            worldDetail: "50m",
            packKeyMode: "canonical",
            contextLayout: "focusLens",
            navigationEnabled: true
        });
        const lens = await page.evaluate(() => {
            const root = document.getElementById("visual-root")!;
            const group = root.querySelector(".profile-lens-lens");
            const rim = root.querySelector(".profile-lens-lens-rim");
            const scrim = root.querySelector(".profile-lens-lens-scrim");
            const surface = root.querySelector(".profile-lens-context")!.getBoundingClientRect();
            const rimBox = rim ? rim.getBoundingClientRect() : null;
            const scrimBox = scrim ? scrim.getBoundingClientRect() : null;
            return {
                present: Boolean(group),
                ariaHidden: group?.getAttribute("aria-hidden") ?? null,
                pointerEvents: group ? getComputedStyle(group).pointerEvents : null,
                targets: group ? group.querySelectorAll("[data-key]").length : -1,
                roles: group ? group.querySelectorAll("[role]").length : -1,
                options: root.querySelectorAll('.profile-lens-context [role="option"]').length,
                semanticInsideLens: group
                    ? group.querySelectorAll('[role="option"]').length
                    : -1,
                mask: Boolean(root.querySelector("#profile-lens-aperture-mask")),
                rimCenter: rimBox
                    ? { x: (rimBox.left + rimBox.right) / 2, y: (rimBox.top + rimBox.bottom) / 2 }
                    : null,
                probeCenter: { x: surface.left + surface.width / 2, y: surface.top + surface.height / 2 },
                scrimCovers: scrimBox
                    ? scrimBox.left <= surface.left
                        && scrimBox.top <= surface.top
                        && scrimBox.right >= surface.right
                        && scrimBox.bottom >= surface.bottom
                    : false
            };
        });
        expect(lens.present).toBe(true);
        expect(lens.ariaHidden).toBe("true");
        expect(lens.pointerEvents).toBe("none");
        expect(lens.targets).toBe(0);
        expect(lens.roles).toBe(0);
        expect(lens.semanticInsideLens).toBe(0);
        expect(lens.mask).toBe(true);
        expect(lens.scrimCovers).toBe(true);
        // The aperture is anchored on the fixed centre probe, not on the chart's own bounding box.
        expect(Math.abs(lens.rimCenter!.x - lens.probeCenter.x)).toBeLessThan(2);
        expect(Math.abs(lens.rimCenter!.y - lens.probeCenter.y)).toBeLessThan(2);
        // The listbox options are still the map features, and nothing was added to them.
        expect(lens.options).toBeGreaterThan(0);

        const hitLens = await page.evaluate(() => {
            const surface = document.querySelector(".profile-lens-context")!.getBoundingClientRect();
            const element = document.elementFromPoint(
                surface.left + surface.width / 2 + 4,
                surface.top + surface.height / 2 + 4
            );
            return element ? element.className.toString() : "";
        });
        expect(hitLens).not.toContain("profile-lens-lens");

        const selectCalls = await page.evaluate(() => (window as unknown as {
            profileLensHost: { calls: { select: number } };
        }).profileLensHost.calls.select);
        expect(selectCalls).toBe(0);
        expect(externalRequests).toEqual([]);
    });

    test("leaves the lens inert outside the focus composition and when disabled", async ({ page }) => {
        for (const contextLayout of ["split", "locatorInset", "profileOnly"]) {
            await mount(page, {
                width: 1280,
                height: 620,
                entities: [...WORLD_50_KEYS.slice(0, 24)],
                periods: [],
                contextMode: "builtInPack",
                contextPack: "worldCountries",
                worldDetail: "50m",
                packKeyMode: "canonical",
                contextLayout,
                navigationEnabled: true
            });
            expect(await page.locator(".profile-lens-lens").count(), contextLayout).toBe(0);
        }
        await mount(page, {
            width: 1280,
            height: 620,
            entities: [...WORLD_50_KEYS.slice(0, 24)],
            periods: [],
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            worldDetail: "50m",
            packKeyMode: "canonical",
            contextLayout: "focusLens",
            showLensScrim: false,
            navigationEnabled: true
        });
        expect(await page.locator(".profile-lens-lens").count()).toBe(0);
        expect(await page.locator(".profile-lens-target").count()).toBeGreaterThan(0);
    });

    test("renders identical chart semantics under SVG and Canvas context surfaces", async ({ page }) => {
        const snapshot = async (): Promise<unknown> => page.evaluate(() => {
            const root = document.getElementById("visual-root")!;
            const chart = root.querySelector("svg.profile-lens-profile-svg")!;
            return {
                renderer: root.querySelector(".profile-lens-context-canvas")
                    && (root.querySelector(".profile-lens-context-canvas") as HTMLCanvasElement).width > 0
                    ? "canvas"
                    : "svg",
                targets: [...root.querySelectorAll(".profile-lens-target")]
                    .map((node) => `${node.getAttribute("data-key")}|${node.getAttribute("aria-label")}`),
                labels: [...chart.querySelectorAll(".profile-lens-chart-label")]
                    .map((node) => `${node.getAttribute("data-label-key")}|${node.textContent}`),
                lens: chart.querySelectorAll(".profile-lens-lens").length,
                aperture: chart.querySelector(".profile-lens-lens-rim")?.getAttribute("r") ?? null
            };
        });
        const shared = {
            width: 1280,
            height: 620,
            entities: [...WORLD_50_KEYS.slice(0, 20)],
            periods: [],
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            worldDetail: "50m",
            packKeyMode: "canonical",
            contextLayout: "focusLens",
            navigationEnabled: true
        };
        await mount(page, { ...shared, svgFeatureThreshold: 5000, svgVertexThreshold: 5000000 });
        const svg = await snapshot();
        await mount(page, { ...shared, svgFeatureThreshold: 1, svgVertexThreshold: 1 });
        const canvas = await snapshot();
        expect(canvas).toEqual(svg);
    });

    test("distinguishes series without colour alone in both themes", async ({ page }) => {
        const shared = {
            width: 1280,
            height: 620,
            entities: ["Entity A"],
            periods: [],
            series: ["Urban", "Rural"],
            profiles: ["Residents"]
        };
        await mount(page, shared);
        const normal = await page.evaluate(() => {
            const root = document.getElementById("visual-root")!;
            const pattern = root.querySelector("#profile-lens-pattern-secondary");
            const fills = [...root.querySelectorAll(".profile-lens-target rect.profile-lens-bar")]
                .map((rect) => rect.getAttribute("fill"));
            return {
                dots: pattern ? pattern.querySelectorAll("circle").length : 0,
                hatches: pattern ? pattern.querySelectorAll("path").length : 0,
                distinctFills: new Set(fills).size,
                mirrored: new Set([...root.querySelectorAll(".profile-lens-target rect.profile-lens-bar")]
                    .map((rect) => Math.sign(Number(rect.getAttribute("y"))))).size
            };
        });
        // A rotation-invariant stipple, not the diagonal hatch that read as noise on rotated arms.
        expect(normal.dots).toBe(1);
        expect(normal.hatches).toBe(0);
        expect(normal.distinctFills).toBeGreaterThan(1);
        // Position already separates the two series, so hue is never the only channel.
        expect(normal.mirrored).toBeGreaterThan(1);

        await mount(page, {
            ...shared,
            highContrast: true,
            highContrastForeground: "#FFFFFF",
            highContrastBackground: "#000000",
            highContrastSelected: "#00FF00"
        });
        const contrast = await page.evaluate(() => {
            const root = document.getElementById("visual-root")!;
            const pattern = root.querySelector("#profile-lens-pattern-secondary");
            return {
                hatches: pattern ? pattern.querySelectorAll("path").length : 0,
                outlined: [...root.querySelectorAll(".profile-lens-target rect.profile-lens-bar")]
                    .every((rect) => rect.getAttribute("stroke") === "#FFFFFF")
            };
        });
        expect(contrast.hatches).toBe(1);
        expect(contrast.outlined).toBe(true);
    });

    test("removes the lens entirely in high contrast, including its arm geometry", async ({ page }) => {
        // A configuration that actually resolves to focusLens. Mounting without a context degrades
        // to profileOnly, where no lens exists in any theme, so a scrim assertion there proves
        // nothing about high contrast at all.
        const shared = {
            width: 1280,
            height: 620,
            entities: [...WORLD_50_KEYS.slice(0, 24)],
            periods: [],
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            worldDetail: "50m",
            packKeyMode: "canonical",
            contextLayout: "focusLens",
            navigationEnabled: true
        };
        const probe = async (): Promise<{
            effectiveFocus: boolean;
            lenses: number;
            scrims: number;
            rims: number;
            masks: number;
            axisStart: number | null;
        }> => page.evaluate(() => {
            const root = document.getElementById("visual-root")!;
            const axis = root.querySelector(".profile-lens-axis");
            const context = root.querySelector(".profile-lens-context")!.getBoundingClientRect();
            const chart = root.querySelector("svg.profile-lens-profile-svg")!
                .getBoundingClientRect();
            return {
                // focusLens is the one composition where the context surface and the chart occupy
                // the same rectangle. Asserting it proves every count below is load bearing rather
                // than vacuously zero because the layout quietly degraded to profileOnly or split.
                effectiveFocus: Math.abs(context.x - chart.x) < 1
                    && Math.abs(context.width - chart.width) < 1
                    && Math.abs(context.height - chart.height) < 1
                    && context.width > 0,
                lenses: root.querySelectorAll(".profile-lens-lens").length,
                scrims: root.querySelectorAll(".profile-lens-lens-scrim").length,
                rims: root.querySelectorAll(".profile-lens-lens-rim").length,
                masks: root.querySelectorAll("#profile-lens-aperture-mask").length,
                axisStart: axis ? Number(axis.getAttribute("x1")) : null
            };
        });

        await mount(page, shared);
        const enabled = await probe();
        expect(enabled.effectiveFocus).toBe(true);
        expect(enabled.lenses).toBe(1);
        expect(enabled.rims).toBe(1);
        expect(enabled.masks).toBe(1);

        await mount(page, { ...shared, showLensScrim: false });
        const disabled = await probe();
        expect(disabled.effectiveFocus).toBe(true);
        expect(disabled.lenses).toBe(0);

        await mount(page, {
            ...shared,
            highContrast: true,
            highContrastForeground: "#FFFFFF",
            highContrastBackground: "#000000",
            highContrastSelected: "#00FF00"
        });
        const contrast = await probe();
        expect(contrast.effectiveFocus).toBe(true);
        // Genuinely absent, not merely undimmed. A rim in the single host foreground would compete
        // with map geometry drawn in that same colour.
        expect(contrast.lenses).toBe(0);
        expect(contrast.scrims).toBe(0);
        expect(contrast.rims).toBe(0);
        expect(contrast.masks).toBe(0);
        // The aperture pushes bandStart outward, so suppressing only the paint would still move
        // every arm. High contrast must match the no-lens geometry exactly.
        expect(contrast.axisStart).toBeCloseTo(disabled.axisStart!, 6);
        expect(contrast.axisStart!).toBeLessThan(enabled.axisStart!);
        expect(externalRequests).toEqual([]);
    });

    test("adds no rebuilds and stays bounded while the lens tracks the probe", async ({ page }) => {
        await mount(page, {
            width: 1280,
            height: 620,
            entities: [...WORLD_50_KEYS.slice(0, 40)],
            periods: [],
            contextMode: "builtInPack",
            contextPack: "worldCountries",
            worldDetail: "50m",
            packKeyMode: "canonical",
            contextLayout: "focusLens",
            navigationEnabled: true
        });
        const surface = page.locator(".profile-lens-context");
        const read = async () => surface.evaluate((node) => {
            const metrics = (node as HTMLElement & {
                __profileLensContextMetrics?: {
                    providerBuilds: number;
                    sceneBuilds: number;
                    sceneIndexBuilds: number;
                    svgGeometryBuilds: number;
                    canvasRasterBuilds: number;
                    canvasPickingBuilds: number;
                    probeTransitions: number;
                    profilePartialUpdates: number;
                    profilePartialDurationsMs: number[];
                };
            }).__profileLensContextMetrics;
            if (!metrics) throw new Error("context metrics are missing");
            return { ...metrics, profilePartialDurationsMs: [...metrics.profilePartialDurationsMs] };
        });
        const before = await read();
        const box = (await surface.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        for (let index = 0; index < 24; index++) {
            await page.mouse.move(
                box.x + box.width / 2 - index * 6,
                box.y + box.height / 2 + index * 3
            );
        }
        await page.mouse.up();
        await page.waitForTimeout(150);
        const after = await read();
        // The lens is drawn in the chart layer, so tracking the probe cannot rebuild the provider,
        // the scene, the reference geometry, the base raster or the picking index.
        expect(after.providerBuilds).toBe(before.providerBuilds);
        expect(after.sceneBuilds).toBe(before.sceneBuilds);
        expect(after.sceneIndexBuilds).toBe(before.sceneIndexBuilds);
        expect(after.svgGeometryBuilds).toBe(before.svgGeometryBuilds);
        expect(after.canvasRasterBuilds).toBe(before.canvasRasterBuilds);
        expect(after.canvasPickingBuilds).toBe(before.canvasPickingBuilds);
        const partialDelta = after.profilePartialUpdates - before.profilePartialUpdates;
        expect(partialDelta).toBeGreaterThan(0);
        expect(partialDelta).toBe(after.probeTransitions - before.probeTransitions);
        const durations = after.profilePartialDurationsMs
            .slice(-partialDelta)
            .sort((left, right) => left - right);
        const p95 = durations[Math.floor((durations.length - 1) * 0.95)] ?? Number.POSITIVE_INFINITY;
        expect(p95).toBeLessThanOrEqual(16.7);
        expect(durations.at(-1)!).toBeLessThanOrEqual(33.4);
        expect(await page.locator(".profile-lens-lens-rim").count()).toBe(1);
        console.log(`Lens probe tracking: ${JSON.stringify({
            partialDelta,
            p95,
            max: durations.at(-1)
        })}`);
        expect(externalRequests).toEqual([]);
    });

    test("holds the label guarantee in RTL, measured on painted geometry", async ({ page }) => {
        const shared = {
            width: 1280,
            height: 620,
            entities: ["Entity A"],
            periods: [],
            series: [],
            bands: ["0 to 17", "18 to 34", "35 to 49", "50 to 64", "65 and over"],
            profiles: ["Residents", "Median income", "Degree holders"]
        };
        // Painted rectangles, not the boxes the engine reserved. Only the browser resolves
        // text-anchor against dir, so this is the measurement that can catch a mirrored box model.
        const painted = async (): Promise<{
            direction: string;
            labels: Array<{ key: string; text: string; anchor: string; x1: number; x2: number; y1: number; y2: number }>;
            chart: { left: number; top: number; right: number; bottom: number };
        }> => page.evaluate(() => {
            const root = document.getElementById("visual-root")!;
            const chartSvg = root.querySelector("svg.profile-lens-profile-svg")!;
            const chart = chartSvg.getBoundingClientRect();
            return {
                direction: getComputedStyle(chartSvg).direction,
                labels: [...root.querySelectorAll(
                    ".profile-lens-label-layer .profile-lens-chart-label"
                )].map((node) => {
                    const rect = node.getBoundingClientRect();
                    return {
                        key: node.getAttribute("data-label-key") ?? "",
                        text: node.textContent ?? "",
                        anchor: node.getAttribute("text-anchor") ?? "",
                        x1: rect.left,
                        x2: rect.right,
                        y1: rect.top,
                        y2: rect.bottom
                    };
                }),
                chart: {
                    left: chart.left,
                    top: chart.top,
                    right: chart.right,
                    bottom: chart.bottom
                }
            };
        });

        for (const value of [
            { name: "explicit rtl", options: { direction: "rtl" } },
            { name: "rtl locale", options: { locale: "he-IL" } }
        ]) {
            await mount(page, { ...shared, ...value.options });
            const result = await painted();
            expect(result.direction, value.name).toBe("rtl");
            expect(result.labels.length, value.name).toBeGreaterThan(0);
            // Edge anchors must actually be exercised, otherwise the direction-relative code path
            // is never reached and the assertions below prove nothing.
            expect(
                result.labels.some((label) => label.anchor === "start" || label.anchor === "end"),
                `${value.name} used no edge anchor`
            ).toBe(true);

            for (let left = 0; left < result.labels.length; left++) {
                for (let right = left + 1; right < result.labels.length; right++) {
                    const a = result.labels[left];
                    const b = result.labels[right];
                    const overlaps = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
                    expect(
                        overlaps,
                        `${value.name}: "${a.text}" overlaps "${b.text}"`
                    ).toBe(false);
                }
            }
            for (const label of result.labels) {
                expect(label.x1, `${value.name}: "${label.text}" escaped left`)
                    .toBeGreaterThanOrEqual(result.chart.left - 1);
                expect(label.x2, `${value.name}: "${label.text}" escaped right`)
                    .toBeLessThanOrEqual(result.chart.right + 1);
                expect(label.y1, `${value.name}: "${label.text}" escaped top`)
                    .toBeGreaterThanOrEqual(result.chart.top - 1);
                expect(label.y2, `${value.name}: "${label.text}" escaped bottom`)
                    .toBeLessThanOrEqual(result.chart.bottom + 1);
            }
        }

        // The same frame in LTR, so the RTL result is a direction difference rather than a
        // configuration that happens to avoid collisions in both directions.
        await mount(page, { ...shared, direction: "ltr" });
        const ltr = await painted();
        expect(ltr.direction).toBe("ltr");
        expect(ltr.labels.length).toBeGreaterThan(0);
        expect(externalRequests).toEqual([]);
    });

    test("keeps proportions and bounded geometry as the tile shrinks", async ({ page }) => {        const observed: Array<{ size: string; ratio: number }> = [];
        for (const size of [
            { width: 1280, height: 620 },
            { width: 760, height: 560 },
            { width: 490, height: 390 }
        ]) {
            await mount(page, {
                width: size.width,
                height: size.height,
                entities: ["Entity A"],
                periods: [],
                series: [],
                profiles: ["Residents", "Median income", "Degree holders"]
            });
            const ratio = await page.evaluate(() => {
                const rects = [...document.querySelectorAll(".profile-lens-arm rect.profile-lens-bar")];
                const widths = rects.map((rect) => Number(rect.getAttribute("width")));
                const xs = rects.map((rect) => Number(rect.getAttribute("x")));
                const span = Math.max(...xs) - Math.min(...xs);
                return widths[0] / (span / Math.max(rects.length / 3 - 1, 1));
            });
            observed.push({ size: `${size.width}x${size.height}`, ratio });
        }
        const first = observed[0].ratio;
        for (const entry of observed) {
            // A fixed design box, not a per-tile recomposition with different relative weights.
            expect(Math.abs(entry.ratio - first), entry.size).toBeLessThan(0.25);
        }
        console.log(`Chart proportion stability: ${JSON.stringify(observed)}`);
    });

    test("fills a wide tile instead of a square of it", async ({ page }) => {
        await mount(page, {
            width: 1520,
            height: 560,
            entities: ["Entity A"],
            periods: [],
            series: ["Urban", "Rural"],
            profiles: ["Residents"]
        });
        const usage = await page.evaluate(() => {
            const chart = document.querySelector("svg.profile-lens-profile-svg")!.getBoundingClientRect();
            const rects = [...document.querySelectorAll(".profile-lens-arm rect.profile-lens-bar")]
                .map((rect) => rect.getBoundingClientRect());
            return {
                chartWidth: chart.width,
                chartHeight: chart.height,
                usedWidth: Math.max(...rects.map((rect) => rect.right))
                    - Math.min(...rects.map((rect) => rect.left)),
                usedHeight: Math.max(...rects.map((rect) => rect.bottom))
                    - Math.min(...rects.map((rect) => rect.top))
            };
        });
        // v1.8 capped the band axis at the inscribed circle, so a 1520x560 tile used a 560 square.
        expect(usage.usedWidth / usage.chartWidth).toBeGreaterThan(0.75);
        expect(usage.usedHeight / usage.chartHeight).toBeGreaterThan(0.5);
        console.log(`Wide tile usage: ${JSON.stringify(usage)}`);
    });
});
