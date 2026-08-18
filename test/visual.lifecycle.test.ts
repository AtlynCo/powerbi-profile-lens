import { beforeEach, describe, expect, it } from "vitest";
import type powerbi from "powerbi-visuals-api";
import { Visual } from "../src/visual";
import { buildEmptyDataView, buildMatrixDataView } from "./helpers/mockDataView";
import { createMockHost, MockHost, mockSelectionId, updateOptions } from "./helpers/mockHost";

function mount(options: Parameters<typeof createMockHost>[0] = {}): {
    mock: MockHost;
    visual: Visual;
} {
    const mock = createMockHost(options);
    const visual = new Visual({
        element: mock.element,
        host: mock.host
    } as unknown as powerbi.extensibility.visual.VisualConstructorOptions);
    return { mock, visual };
}

function dataView(overrides: Parameters<typeof buildMatrixDataView>[0] | null = null): powerbi.DataView {
    return buildMatrixDataView(overrides ?? {
        entities: ["Entity A", "Entity B"],
        bands: ["Band 1", "Band 2", "Band 3"],
        series: ["Series X", "Series Y"],
        profiles: ["Metric A", "Metric B", "Metric C"]
    });
}

function resetDocument(): void {
    while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
    }
}

function targets(root: HTMLElement): SVGGElement[] {
    return [...root.querySelectorAll<SVGGElement>(".profile-lens-target")];
}

function pointer(type: string, extra: Record<string, unknown> = {}): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { clientX: 10, clientY: 20, pointerType: "mouse", ...extra });
    return event;
}

describe("visual lifecycle", () => {
    beforeEach(() => {
        resetDocument();
    });

    it("signals exactly one rendering start and finish for a data update", () => {
        const { mock, visual } = mount();
        const options = updateOptions(dataView());
        visual.update(options);
        expect(mock.events.started).toHaveLength(1);
        expect(mock.events.finished).toHaveLength(1);
        expect(mock.events.failed).toHaveLength(0);
    });

    it("signals exactly one start and finish for an empty data view", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildEmptyDataView()));
        expect(mock.events.started).toHaveLength(1);
        expect(mock.events.finished).toHaveLength(1);
        expect(mock.events.failed).toHaveLength(0);
        expect(mock.element.querySelector(".profile-lens-landing")?.getAttribute("data-stage"))
            .toBe("empty");
    });

    it("keeps the last valid model for a lifecycle only update", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        const renderedBefore = targets(mock.element).length;
        expect(renderedBefore).toBeGreaterThan(0);

        visual.update(updateOptions(undefined, { width: 400, height: 300 }));
        expect(mock.events.started).toHaveLength(2);
        expect(mock.events.finished).toHaveLength(2);
        expect(mock.events.failed).toHaveLength(0);
        expect(targets(mock.element).length).toBe(renderedBefore);
    });

    it("signals exactly one failure when the data view cannot be read", () => {
        const { mock, visual } = mount();
        const broken = dataView();
        Object.defineProperty(broken.matrix!.rows!, "root", {
            get() {
                throw new Error("row hierarchy unavailable");
            }
        });
        visual.update(updateOptions(broken));
        expect(mock.events.started).toHaveLength(1);
        expect(mock.events.finished).toHaveLength(0);
        expect(mock.events.failed).toHaveLength(1);
        expect(mock.events.failed[0].reason).toContain("row hierarchy unavailable");
        expect(mock.element.querySelector(".profile-lens-error")).not.toBeNull();
    });

    it("renders one interactive target per profile, band and series", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        expect(targets(mock.element)).toHaveLength(3 * 3 * 2);
        expect(targets(mock.element)[0].getAttribute("role")).toBe("button");
        expect(targets(mock.element)[0].getAttribute("aria-label")).toContain("Metric A");
    });

    it("requests more data at most once per bounded segment budget", () => {
        const { mock, visual } = mount();
        const segmented = buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            segment: true
        });
        visual.update(updateOptions(segmented));
        expect(mock.fetchMoreData).toHaveBeenCalledTimes(1);
        const codes = [...mock.element.querySelectorAll(".profile-lens-diagnostic")]
            .map((node) => node.getAttribute("data-code"));
        expect(codes).toContain("partialData");
    });

    it("does not request segments in eager or report-driven detail modes", () => {
        for (const strategy of ["eager", "external"]) {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                segment: true,
                objects: {
                    loading: { strategy }
                }
            })));
            expect(mock.fetchMoreData, strategy).not.toHaveBeenCalled();
            visual.destroy();
            mock.element.remove();
        }
    });
});

describe("interaction", () => {
    beforeEach(() => {
        resetDocument();
    });

    it("selects the band identity on click", async () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        targets(mock.element)[0].dispatchEvent(pointer("click"));
        await Promise.resolve();
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(mock.selection.select.mock.calls[0][1]).toBe(false);
    });

    it("shows the context menu exactly once for a data point", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        targets(mock.element)[0].dispatchEvent(pointer("contextmenu"));
        expect(mock.selection.showContextMenu).toHaveBeenCalledTimes(1);
        expect(mock.selection.showContextMenu.mock.calls[0][0]).not.toBeNull();
    });

    it("shows the context menu exactly once for empty space", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        const root = mock.element.querySelector<HTMLElement>(".profile-lens");
        root?.dispatchEvent(pointer("contextmenu"));
        expect(mock.selection.showContextMenu).toHaveBeenCalledTimes(1);
    });

    it("runs the native tooltip lifecycle once per hover", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        const target = targets(mock.element)[0];
        target.dispatchEvent(pointer("pointerover"));
        target.dispatchEvent(pointer("pointermove"));
        target.dispatchEvent(pointer("pointerout"));
        expect(mock.tooltip.show).toHaveBeenCalledTimes(1);
        expect(mock.tooltip.move).toHaveBeenCalledTimes(1);
        expect(mock.tooltip.hide).toHaveBeenCalledTimes(1);
        const shown = mock.tooltip.show.mock.calls[0][0] as {
            dataItems: Array<{ displayName: string }>;
        };
        const items = shown.dataItems;
        expect(items.map((item) => item.displayName)).toContain("Band");
    });

    it("makes disabled controls nonfocusable and ignores keyboard activation", () => {
        const { mock, visual } = mount({ allowInteractions: false });
        visual.update(updateOptions(dataView()));
        const renderedTargets = targets(mock.element);
        const target = renderedTargets[1];
        target.dispatchEvent(pointer("click"));
        target.dispatchEvent(pointer("pointerover"));
        target.dispatchEvent(pointer("contextmenu"));
        const enter = new Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(enter, { key: "Enter" });
        target.dispatchEvent(enter);
        const arrow = new Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(arrow, { key: "ArrowRight" });
        target.dispatchEvent(arrow);
        mock.element.querySelector<HTMLElement>(".profile-lens")?.dispatchEvent(pointer("contextmenu"));
        const entity = mock.element.querySelector<HTMLElement>('[data-entity-index="1"]');
        entity?.dispatchEvent(pointer("click"));
        expect(mock.selection.select).not.toHaveBeenCalled();
        expect(mock.selection.showContextMenu).not.toHaveBeenCalled();
        expect(mock.tooltip.show).not.toHaveBeenCalled();
        expect(renderedTargets.length).toBeGreaterThan(1);
        expect(target.getAttribute("role")).toBe("button");
        expect(target.getAttribute("aria-disabled")).toBe("true");
        expect(renderedTargets.every((element) => element.getAttribute("tabindex") === "-1"))
            .toBe(true);
        expect(mock.element.querySelector('[data-entity-index="0"]')?.getAttribute("tabindex"))
            .toBe("-1");
        const codes = [...mock.element.querySelectorAll(".profile-lens-diagnostic")]
            .map((node) => node.getAttribute("data-code"));
        expect(codes).toContain("interactionsDisabled");
        expect(mock.element.querySelector('[data-entity-index="0"]')?.getAttribute("aria-selected"))
            .toBe("true");
    });

    it("redirects pointer-caused focus away from disabled chart targets", () => {
        const { mock, visual } = mount({ allowInteractions: false });
        visual.update(updateOptions(dataView()));
        const root = mock.element.querySelector<HTMLElement>(".profile-lens");
        const renderedTargets = targets(mock.element);
        const target = renderedTargets[1];

        target.dispatchEvent(pointer("pointerdown"));
        target.focus();
        target.dispatchEvent(pointer("click"));

        expect(document.activeElement).toBe(root);
        expect(renderedTargets.every((element) => element.getAttribute("tabindex") === "-1"))
            .toBe(true);
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("redirects pointer-caused focus away from disabled entity and period controls", () => {
        const { mock, visual } = mount({ allowInteractions: false });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            periods: ["Period 1", "Period 2"],
            bands: ["Band 1"],
            profiles: ["Metric A"]
        })));
        const root = mock.element.querySelector<HTMLElement>(".profile-lens");
        const entity = mock.element.querySelector<HTMLElement>('[data-entity-index="1"]');
        const period = mock.element.querySelector<HTMLElement>(".profile-lens-period-slider");
        const entityContainer = mock.element.querySelector<HTMLElement>(".profile-lens-entities");

        entity?.dispatchEvent(pointer("pointerdown"));
        entity?.focus();
        entity?.dispatchEvent(pointer("click"));
        expect(document.activeElement).toBe(root);
        expect(entity?.getAttribute("tabindex")).toBe("-1");
        expect(entityContainer?.getAttribute("aria-disabled")).toBe("true");
        expect(entityContainer?.getAttribute("tabindex")).toBe("-1");

        period?.dispatchEvent(pointer("pointerdown"));
        period?.focus();
        period?.dispatchEvent(pointer("click"));
        expect(document.activeElement).toBe(root);
        expect(period?.getAttribute("tabindex")).toBe("-1");
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("moves entity list focus and selection with arrow, Home, and End keys", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        const first = mock.element.querySelector<HTMLElement>('[data-entity-index="0"]');
        first?.focus();

        const end = new Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(end, { key: "End" });
        first?.dispatchEvent(end);

        const last = mock.element.querySelector<HTMLElement>('[data-entity-index="1"]');
        expect(last?.getAttribute("aria-selected")).toBe("true");
        expect(last?.getAttribute("tabindex")).toBe("0");
        expect(document.activeElement).toBe(last);

        const home = new Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(home, { key: "Home" });
        last?.dispatchEvent(home);
        const restored = mock.element.querySelector<HTMLElement>('[data-entity-index="0"]');
        expect(restored?.getAttribute("aria-selected")).toBe("true");
        expect(document.activeElement).toBe(restored);
    });

    it("moves roving focus with the arrow keys and selects with Enter", async () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        const rendered = targets(mock.element);
        expect(rendered[0].getAttribute("tabindex")).toBe("0");

        const arrow = new Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(arrow, { key: "ArrowRight" });
        rendered[0].dispatchEvent(arrow);
        expect(rendered[0].getAttribute("tabindex")).toBe("-1");
        expect(rendered[1].getAttribute("tabindex")).toBe("0");

        const enter = new Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(enter, { key: "Enter" });
        rendered[1].dispatchEvent(enter);
        await Promise.resolve();
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
    });

    it("restores the focused target by key after a rerender", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        const before = targets(mock.element);
        const arrow = new Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(arrow, { key: "ArrowRight" });
        before[0].dispatchEvent(arrow);
        const focusedKey = before[1].getAttribute("data-key");

        visual.update(updateOptions(undefined, { width: 640, height: 480 }));
        const after = targets(mock.element);
        const focused = after.find((element) => element.getAttribute("tabindex") === "0");
        expect(focused?.getAttribute("data-key")).toBe(focusedKey);
    });

    it("restores a valid roving tab stop when the focused target disappears", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        const before = targets(mock.element);
        const last = before[before.length - 1];
        last.focus();
        last.dispatchEvent(new Event("focus"));

        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            profiles: ["Metric A"]
        })));

        const after = targets(mock.element);
        expect(after).toHaveLength(1);
        expect(after[0].getAttribute("tabindex")).toBe("0");
        expect(document.activeElement).toBe(after[0]);
    });

    it("reflects an external selection callback in the rendered state", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        expect(mock.selection.onSelectCallback).not.toBeNull();
        mock.selection.onSelectCallback?.([mockSelectionId("|node:band:0:-1:0")]);
        const pressed = targets(mock.element).filter(
            (element) => element.getAttribute("aria-pressed") === "true"
        );
        expect(pressed.length).toBe(3 * 2);
    });

    it("uses the entity matrix identity for context selection", async () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context");
        surface?.dispatchEvent(pointer("click", { clientX: 40, clientY: 250 }));
        await Promise.resolve();
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        const identity = mock.selection.select.mock.calls[0][0] as { getKey: () => string };
        expect(identity.getKey()).toContain("entity:0");
    });

    it.each([
        ["localOnly", "pointer", 0, 0],
        ["reportSelection", "pointer", 0, 1],
        ["localOnly", "keyboard", 0, 0],
        ["reportSelection", "keyboard", 0, 1]
    ] as const)(
        "keeps %s %s navigation and activation coherent",
        (interactionMode, inputKind, expectedFilters, expectedSelections) => {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    interaction: { mode: interactionMode }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context");
            if (inputKind === "pointer") {
                surface?.dispatchEvent(pointer("click", { clientX: 280, clientY: 250 }));
            } else {
                surface?.focus();
                const right = new Event("keydown", { bubbles: true, cancelable: true });
                Object.assign(right, { key: "ArrowRight" });
                surface?.dispatchEvent(right);
                expect(mock.applyJsonFilter).not.toHaveBeenCalled();
                expect(mock.selection.select).not.toHaveBeenCalled();
                const enter = new Event("keydown", { bubbles: true, cancelable: true });
                Object.assign(enter, { key: "Enter" });
                surface?.dispatchEvent(enter);
            }
            expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
                .toBe("Entity B");
            expect(surface?.getAttribute("aria-activedescendant")).toBe("context:entity:1");
            expect(mock.applyJsonFilter).toHaveBeenCalledTimes(expectedFilters);
            expect(mock.selection.select).toHaveBeenCalledTimes(expectedSelections);
        }
    );

    it.each([
        ["localOnly", "pointer", 0, 0],
        ["reportSelection", "pointer", 0, 1],
        ["localOnly", "keyboard", 0, 0],
        ["reportSelection", "keyboard", 0, 1]
    ] as const)(
        "keeps no-context %s %s navigation and activation coherent",
        async (interactionMode, inputKind, expectedFilters, expectedSelections) => {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "none" },
                    interaction: { mode: interactionMode }
                }
            })));
            if (inputKind === "pointer") {
                mock.element.querySelector<HTMLElement>('[data-entity-index="1"]')?.click();
            } else {
                const first = mock.element.querySelector<HTMLElement>('[data-entity-index="0"]');
                first?.focus();
                const right = new Event("keydown", { bubbles: true, cancelable: true });
                Object.assign(right, { key: "ArrowRight" });
                first?.dispatchEvent(right);
                expect(mock.applyJsonFilter).not.toHaveBeenCalled();
                expect(mock.selection.select).not.toHaveBeenCalled();
                const second = mock.element.querySelector<HTMLElement>('[data-entity-index="1"]');
                const enter = new Event("keydown", { bubbles: true, cancelable: true });
                Object.assign(enter, { key: "Enter" });
                second?.dispatchEvent(enter);
            }
            await Promise.resolve();
            expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
                .toBe("Entity B");
            expect(mock.element.querySelector('[data-entity-index="1"]')
                ?.getAttribute("aria-selected")).toBe("true");
            expect(mock.applyJsonFilter).toHaveBeenCalledTimes(expectedFilters);
            expect(mock.selection.select).toHaveBeenCalledTimes(expectedSelections);
        }
    );

    it("starts context navigation from no-context local focus after context re-entry", () => {
        const { mock, visual } = mount();
        const build = (contextMode: "none" | "grid"): powerbi.DataView =>
            buildMatrixDataView({
                entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: contextMode },
                    interaction: { mode: "localOnly" }
                }
            });
        visual.update(updateOptions(build("none")));
        mock.element.querySelector<HTMLElement>('[data-entity-index="1"]')?.click();
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity B");

        visual.update(updateOptions(build("grid")));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context");
        surface?.focus();
        expect(surface?.getAttribute("aria-activedescendant")).toBe("context:entity:1");
        const down = new Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(down, { key: "ArrowDown" });
        surface?.dispatchEvent(down);
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity D");
        expect(surface?.getAttribute("aria-activedescendant")).toBe("context:entity:3");
        expect(mock.applyJsonFilter).not.toHaveBeenCalled();
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("redirects disabled physical focus from context without host mutation", () => {
        const { mock, visual } = mount({ allowInteractions: false });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                interaction: { mode: "localOnly" }
            }
        })));
        const root = mock.element.querySelector<HTMLElement>(".profile-lens");
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context");
        surface?.dispatchEvent(pointer("pointerdown", { clientX: 40, clientY: 250 }));
        surface?.focus();
        surface?.dispatchEvent(pointer("click", { clientX: 40, clientY: 250 }));
        surface?.dispatchEvent(pointer("contextmenu", { clientX: 40, clientY: 250 }));
        expect(document.activeElement).toBe(root);
        expect(surface?.getAttribute("tabindex")).toBe("-1");
        expect(mock.selection.select).not.toHaveBeenCalled();
        expect(mock.selection.showContextMenu).not.toHaveBeenCalled();
        expect(mock.tooltip.show).not.toHaveBeenCalled();
        expect(mock.applyJsonFilter).not.toHaveBeenCalled();
    });
});

describe("accessibility and theming", () => {
    beforeEach(() => {
        resetDocument();
    });

    it("renders a semantic table with bands as rows and profile by series columns", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        const table = mock.element.querySelector("table");
        expect(table).not.toBeNull();
        expect(table?.querySelector("caption")?.textContent).toContain("Entity A");
        expect(table?.querySelectorAll("tbody tr")).toHaveLength(3);
        expect(table?.querySelectorAll("thead th")).toHaveLength(1 + 3 * 2);
    });

    it("keeps the table in the accessibility tree when it is not visible", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        const container = mock.element.querySelector(".profile-lens-table");
        expect(container?.className).toContain("profile-lens-table-sr");
        expect(container?.hasAttribute("hidden")).toBe(false);
    });

    it("publishes a polite status region", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView()));
        const status = mock.element.querySelector(".profile-lens-status");
        expect(status?.getAttribute("role")).toBe("status");
        expect(status?.getAttribute("aria-live")).toBe("polite");
        expect(status?.getAttribute("aria-busy")).toBe("false");
    });

    it("uses the host high contrast colors and pattern differentiation", () => {
        const { mock, visual } = mount({ highContrast: true });
        visual.update(updateOptions(dataView()));
        const root = mock.element.querySelector(".profile-lens");
        expect(root?.classList.contains("profile-lens-high-contrast")).toBe(true);
        const rect = mock.element.querySelector(".profile-lens-target rect");
        expect(rect?.getAttribute("fill")).toBe("#FFFFFF");
        expect(rect?.getAttribute("stroke")).toBe("#FFFFFF");
        expect(mock.element.querySelector("pattern")).not.toBeNull();
    });

    it("switches direction for a right to left locale", () => {
        const { mock, visual } = mount({ locale: "he-IL" });
        visual.update(updateOptions(dataView()));
        expect(mock.element.querySelector(".profile-lens")?.getAttribute("dir")).toBe("rtl");
    });

    it("applies formatting properties from the data view objects", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(dataView({
            entities: ["Entity A"],
            bands: ["Band 1", "Band 2"],
            profiles: ["Metric A"],
            objects: {
                data: { normalization: "shareOfProfile" },
                period: { position: "top" },
                accessibility: { showTable: "visible" }
            } as unknown as powerbi.DataViewObjects
        })));
        const period = mock.element.querySelector<HTMLElement>(".profile-lens-period");
        expect(period?.style.order).toBe("2");
        expect(mock.element.querySelector(".profile-lens-table")?.className)
            .toContain("profile-lens-table-visible");
        const firstCell = mock.element.querySelector("tbody td");
        expect(firstCell?.textContent).toContain("%");
    });

    it("reports zero denominators produced by proportional normalization", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1", "Band 2"],
            profiles: ["Metric A"],
            value: () => 0,
            objects: {
                data: { normalization: "shareOfProfile" }
            } as unknown as powerbi.DataViewObjects
        })));
        const diagnostic = mock.element.querySelector('[data-code="zeroDenominator"]');
        expect(diagnostic).not.toBeNull();
        expect(diagnostic?.textContent).toContain("2");
        expect(targets(mock.element)[0].getAttribute("aria-label"))
            .toContain("raw value 0, no normalization denominator");
        expect(mock.element.querySelector("tbody tr:first-child td")?.textContent)
            .toBe("no denominator, raw 0");
    });

    it("rejects negative profile values before drawing a magnitude", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Negative", "Positive"],
            profiles: ["Metric A"],
            value: ({ bandIndex }) => bandIndex === 0 ? -1234.5 : 20
        })));
        const rendered = targets(mock.element);
        expect(rendered[0].querySelector("rect")?.getAttribute("stroke-dasharray")).toBe("2 2");
        expect(rendered[1].querySelector("rect")?.hasAttribute("stroke-dasharray")).toBe(false);
        expect(rendered[0].getAttribute("aria-label"))
            .toContain("negative value -1,234.5 unsupported");
        expect(mock.element.querySelector('[data-code="negativeProfileValues"]')?.textContent)
            .toContain("1");
        expect(mock.element.querySelector("tbody tr:first-child td")?.textContent)
            .toBe("negative value unsupported, raw -1,234.5");
    });

    it("preserves rejected non-numeric and non-finite states for nonvisual readers", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Text", "Infinite"],
            profiles: ["Metric A"],
            value: ({ bandIndex }) => bandIndex === 0 ? "not a number" : Number.POSITIVE_INFINITY
        })));
        const rendered = targets(mock.element);
        expect(rendered[0].getAttribute("aria-label")).toContain("non-numeric value unsupported");
        expect(rendered[1].getAttribute("aria-label")).toContain("non-finite value \u221e unsupported");
        const cells = [...mock.element.querySelectorAll("tbody td")].map((cell) => cell.textContent);
        expect(cells).toEqual([
            "non-numeric value unsupported",
            "non-finite value \u221e unsupported"
        ]);
    });

    it("shows progressive landing guidance before the contract is complete", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            profiles: []
        })));
        const landing = mock.element.querySelector(".profile-lens-landing");
        expect(landing?.getAttribute("data-stage")).toBe("needsProfile");
        const steps = [...(landing?.querySelectorAll("li") ?? [])]
            .map((item) => item.getAttribute("data-complete"));
        expect(steps).toEqual(["true", "true", "true", "false", "false"]);
        expect(landing?.textContent).toContain("Context is optional");
    });

    it("renders bound point context only when its provider is selected", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1", "Band 2"],
            profiles: ["Metric A"],
            latitude: () => 40,
            longitude: () => -70,
            geometry: () => '{"type":"Point","coordinates":[0,0]}',
            objects: {
                context: { mode: "points" }
            }
        })));
        const codes = [...mock.element.querySelectorAll(".profile-lens-diagnostic")]
            .map((node) => node.getAttribute("data-code"));
        expect(codes).not.toContain("extensionRolesProfileOnly");
        expect(mock.element.querySelector(".profile-lens-context")?.hasAttribute("hidden")).toBe(false);
        expect(mock.element.querySelectorAll(
            ".profile-lens-context-svg [data-context-key] circle"
        )).toHaveLength(1);
    });

    it("surfaces safe raw geometry rejection details without markup injection", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            geometry: () => "POINT(1 2) trailing<script>bad</script>",
            objects: {
                context: { mode: "boundGeometry" }
            }
        })));
        const diagnostic = mock.element.querySelector('[data-code="geometryParseRejected"]');
        expect(diagnostic?.textContent).toContain("POINT(1 2) trailing<script>");
        expect(diagnostic?.querySelector("script")).toBeNull();
    });
});
