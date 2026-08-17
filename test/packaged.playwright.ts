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

    test("uses the host high contrast colors", async ({ page }) => {
        await mount(page, { highContrast: true });
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
});
