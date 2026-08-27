import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type powerbi from "powerbi-visuals-api";
import { Visual } from "../src/visual";
import { buildEmptyDataView, buildMatrixDataView } from "./helpers/mockDataView";
import { createMockHost, MockHost, mockSelectionId, updateOptions } from "./helpers/mockHost";

const mountedVisuals: Visual[] = [];

function mount(options: Parameters<typeof createMockHost>[0] = {}): {
    mock: MockHost;
    visual: Visual;
} {
    const mock = createMockHost(options);
    const visual = new Visual({
        element: mock.element,
        host: mock.host
    } as unknown as powerbi.extensibility.visual.VisualConstructorOptions);
    mountedVisuals.push(visual);
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

    afterEach(() => {
        while (mountedVisuals.length > 0) {
            mountedVisuals.pop()?.destroy();
        }
        resetDocument();
    });
}

function targets(root: HTMLElement): SVGGElement[] {
    return [...root.querySelectorAll<SVGGElement>(".profile-lens-target")];
}

function pointer(type: string, extra: Record<string, unknown> = {}): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { clientX: 10, clientY: 20, pointerType: "mouse", ...extra });
    return event;
}

function key(type: string, value: string, extra: Record<string, unknown> = {}): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { key: value, ...extra });
    return event;
}

function setSurfaceBounds(
    surface: HTMLElement,
    width = 320,
    height = 300
): void {
    surface.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height,
        toJSON: () => ({})
    });
}

function contextMetrics(root: HTMLElement): {
    homeZoom: number;
    cameraZoom: number;
    panX: number;
    panY: number;
    providerBuilds: number;
    sceneBuilds: number;
    sceneIndexBuilds: number;
    svgGeometryBuilds: number;
    canvasRasterBuilds: number;
    canvasPickingBuilds: number;
    cameraFrames: number;
    moveEnds: number;
    probeResolutions: number;
    probeTransitions: number;
    probeDedupes: number;
    profilePartialUpdates: number;
    hostSelectionRequests: number;
    hostSelectionResolved: number;
    hostSelectionRejected: number;
    hostSelectionStale: number;
    hostSelectionQueued: number;
    hostSelectionCoalesced: number;
    hostSelectionExternalInvalidations: number;
    hostSelectionInFlight: number;
    maxHostSelectionInFlight: number;
} {
    return (root as HTMLElement & {
        __profileLensContextMetrics: {
            homeZoom: number;
            cameraZoom: number;
            panX: number;
            panY: number;
            providerBuilds: number;
            sceneBuilds: number;
            sceneIndexBuilds: number;
            svgGeometryBuilds: number;
            canvasRasterBuilds: number;
            canvasPickingBuilds: number;
            cameraFrames: number;
            moveEnds: number;
            probeResolutions: number;
            probeTransitions: number;
            probeDedupes: number;
            profilePartialUpdates: number;
            hostSelectionRequests: number;
            hostSelectionResolved: number;
            hostSelectionRejected: number;
            hostSelectionStale: number;
            hostSelectionQueued: number;
            hostSelectionCoalesced: number;
            hostSelectionExternalInvalidations: number;
            hostSelectionInFlight: number;
            maxHostSelectionInFlight: number;
        };
    }).__profileLensContextMetrics;
}

function cameraValues(root: HTMLElement): readonly number[] {
    const transform = root.querySelector(".profile-lens-context-outline-layer")
        ?.getAttribute("transform") ?? "";
    const values = transform.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number) ?? [];
    expect(values).toHaveLength(6);
    return values;
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

    it("renders exact built-in pack joins with cartographic attribution", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA", "NE:KOS", " usa"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    worldDetail: "110m",
                    packKeyMode: "canonical"
                }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context");
        expect(surface?.getAttribute("aria-setsize")).toBe("177");
        expect(surface?.getAttribute("aria-description")).toContain("Natural Earth 5.1.1");
        expect(mock.element.querySelector("[data-context-key='USA']")).not.toBeNull();
        expect(mock.element.querySelector("[data-context-key='NE:KOS']")).not.toBeNull();
        expect(mock.element.querySelectorAll("[role='option']").length).toBeLessThanOrEqual(100);
        expect(mock.element.querySelector('[data-code="malformedPackKey"]')?.textContent)
            .toContain(" usa");
    });

    it("keeps Census pack keys as exact text without numeric coercion", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["06", "60", "6"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "usStates",
                    packKeyMode: "auto"
                }
            }
        })));
        expect(mock.element.querySelector(".profile-lens-context")?.getAttribute("aria-setsize"))
            .toBe("56");
        expect(mock.element.querySelector('[data-code="malformedPackKey"]')).not.toBeNull();
    });

    it.each([
        ["worldCountries", "canonical", 177],
        ["usStates", "geoid2", 56]
    ] as const)(
        "renders a binding-free %s pack backdrop with zero report entities",
        (pack, packKeyMode, expectedFeatures) => {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: [],
                bands: [],
                profiles: [],
                objects: {
                    context: {
                        mode: "builtInPack",
                        pack,
                        packKeyMode
                    }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            expect(mock.events.failed, JSON.stringify(mock.events.failed)).toHaveLength(0);
            expect(surface.hasAttribute("hidden")).toBe(false);
            expect(surface.getAttribute("aria-setsize")).toBe(String(expectedFeatures));
            expect(surface.classList.contains("profile-lens-context-navigation-active")).toBe(true);
            expect(mock.element.querySelector(".profile-lens-landing")?.hasAttribute("hidden"))
                .toBe(true);
            expect(mock.element.querySelectorAll(".profile-lens-target")).toHaveLength(0);
            expect(mock.element.querySelector(".profile-lens-table")?.textContent)
                .toContain("No data in current report context");
            expect(mock.selection.select).not.toHaveBeenCalled();
            expect(mock.element.querySelectorAll(".profile-lens-context-semantic [role='option']")
                .length).toBeLessThanOrEqual(100);
        }
    );

    it("keeps a zero-row backdrop static when host interactions are disabled", () => {
        const { mock, visual } = mount({ allowInteractions: false });
        visual.update(updateOptions(buildMatrixDataView({
            entities: [],
            bands: [],
            profiles: [],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        expect(surface.getAttribute("aria-setsize")).toBe("177");
        expect(surface.getAttribute("tabindex")).toBe("-1");
        expect(surface.classList.contains("profile-lens-context-navigation-active")).toBe(false);
        expect(mock.selection.select).not.toHaveBeenCalled();
        expect(mock.tooltip.show).not.toHaveBeenCalled();
    });

    it("renders a persisted pack from an otherwise empty DataView", () => {
        const { mock, visual } = mount();
        const empty = {
            metadata: {
                columns: [],
                objects: {
                    context: {
                        mode: "builtInPack",
                        pack: "worldCountries",
                        packKeyMode: "canonical"
                    }
                }
            }
        } as unknown as powerbi.DataView;
        visual.update(updateOptions(empty));
        expect(mock.events.failed).toHaveLength(0);
        expect(mock.element.querySelector(".profile-lens-context")?.getAttribute("aria-setsize"))
            .toBe("177");
        expect(mock.element.querySelector(".profile-lens-landing")?.hasAttribute("hidden"))
            .toBe(true);
        expect(mock.element.querySelectorAll(".profile-lens-target")).toHaveLength(0);
    });

    it("binds later report data without resetting camera or rebuilding stable backdrop", () => {
        const { mock, visual } = mount();
        const objects = {
            context: {
                mode: "builtInPack",
                pack: "worldCountries",
                packKeyMode: "canonical"
            },
            interaction: { mode: "localOnly" }
        } as unknown as powerbi.DataViewObjects;
        visual.update(updateOptions(buildMatrixDataView({
            entities: [],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.focus();
        surface.dispatchEvent(key("keydown", "+"));
        surface.dispatchEvent(key("keydown", "ArrowLeft", { shiftKey: true }));
        const transform = mock.element.querySelector(".profile-lens-context-camera-layer")
            ?.getAttribute("transform");
        const before = { ...contextMetrics(surface) };

        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects
        })));
        const after = contextMetrics(surface);
        expect(mock.element.querySelector(".profile-lens-context-camera-layer")
            ?.getAttribute("transform")).toBe(transform);
        expect(after.sceneBuilds).toBe(before.sceneBuilds + 1);
        expect(after.svgGeometryBuilds).toBe(before.svgGeometryBuilds);
        expect(after.canvasRasterBuilds).toBe(before.canvasRasterBuilds);
        expect(after.canvasPickingBuilds).toBe(before.canvasPickingBuilds);
        expect(after.cameraFrames).toBe(before.cameraFrames);
    });

    it("preserves a focused pack feature when later filters remove every binding", () => {
        const { mock, visual } = mount();
        const objects = {
            context: {
                mode: "builtInPack",
                pack: "worldCountries",
                packKeyMode: "canonical"
            },
            navigation: { enabled: false }
        } as unknown as powerbi.DataViewObjects;
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects
        })));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("United States of America");
        visual.update(updateOptions(buildMatrixDataView({
            entities: [],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects
        })));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("United States of America");
        expect(mock.element.querySelector(".profile-lens-header-subtitle")?.textContent)
            .toContain("No data in current report context");
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .not.toContain("No Context feature");
    });

    it("keeps bound Context values in semantic option descriptions", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            contextValue: (entityIndex) => entityIndex + 2.5,
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false }
            }
        })));
        expect(mock.element.querySelector("[id='context:entity:0']")
            ?.getAttribute("aria-label")).toContain("Context value: 2.5");
        expect(mock.element.querySelector("[id='context:entity:1']")
            ?.getAttribute("aria-label")).toContain("Context value: 3.5");
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

    it("lets auto probe focus supersede no-context focus after context re-entry", () => {
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
        expect(surface?.getAttribute("aria-activedescendant")).toBe("context:entity:3");
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity D");
        const up = new Event("keydown", { bubbles: true, cancelable: true });
        Object.assign(up, { key: "ArrowUp" });
        surface?.dispatchEvent(up);
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity B");
        expect(surface?.getAttribute("aria-activedescendant")).toBe("context:entity:1");
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

    it("applies migration-safe auto/on/off navigation behavior", () => {
        const render = (
            entities: readonly string[],
            enabled: boolean | undefined,
            allowInteractions = true,
            profileOnly = false
        ) => {
            resetDocument();
            const { mock, visual } = mount({ allowInteractions });
            visual.update(updateOptions(buildMatrixDataView({
                entities,
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    ...(profileOnly ? { layout: { contextLayout: "profileOnly" } } : {}),
                    ...(enabled === undefined ? {} : { navigation: { enabled } })
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            return {
                active: surface.classList.contains("profile-lens-context-navigation-active"),
                probe: mock.element.querySelector(".profile-lens-context-probe"),
                hidden: surface.hasAttribute("hidden")
            };
        };
        expect(render(["Entity A", "Entity B"], undefined)).toMatchObject({
            active: true,
            probe: expect.anything(),
            hidden: false
        });
        expect(render(["Entity A"], undefined)).toEqual({
            active: false,
            probe: null,
            hidden: false
        });
        expect(render(["Entity A", "Entity B"], false)).toEqual({
            active: false,
            probe: null,
            hidden: false
        });
        expect(render(["Entity A"], true)).toMatchObject({
            active: true,
            probe: expect.anything(),
            hidden: false
        });
        expect(render(["Entity A", "Entity B"], undefined, false)).toEqual({
            active: false,
            probe: null,
            hidden: false
        });
        expect(render(["Entity A", "Entity B"], undefined, true, true)).toEqual({
            active: false,
            probe: null,
            hidden: true
        });
    });

    it("hard-stops a pressed Entity control when host interactions disable", () => {
        const { mock, visual } = mount();
        const view = buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: { context: { mode: "none" } }
        });
        visual.update(updateOptions(view));
        const pressed = mock.element.querySelectorAll<HTMLElement>(
            ".profile-lens-entity-option"
        )[1]!;
        pressed.dispatchEvent(pointer("pointerdown", {
            pointerId: 601,
            button: 0,
            clientX: 10,
            clientY: 10
        }));
        (mock.host.hostCapabilities as { allowInteractions: boolean })
            .allowInteractions = false;
        visual.update(updateOptions(undefined));
        pressed.dispatchEvent(pointer("pointerup", {
            pointerId: 601,
            clientX: 10,
            clientY: 10
        }));
        pressed.dispatchEvent(pointer("click", {
            clientX: 10,
            clientY: 10
        }));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity A");
        expect(mock.selection.select).not.toHaveBeenCalled();
        expect(mock.element.querySelector('[data-entity-index="1"]')
            ?.getAttribute("aria-disabled")).toBe("true");
    });

    it("keeps one profile roving tab stop alongside probe-driven Context focus", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1", "Band 2"],
            profiles: ["Metric A"],
            objects: { context: { mode: "grid" } }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        const profileTabStops = () => [...mock.element.querySelectorAll(".profile-lens-target")]
            .filter((target) => target.getAttribute("tabindex") === "0");
        expect(profileTabStops()).toHaveLength(1);
        expect(surface.getAttribute("tabindex")).toBe("0");
        surface.focus();
        surface.dispatchEvent(key("keydown", "+"));
        expect(document.activeElement).toBe(surface);
        surface.dispatchEvent(key("keydown", "ArrowLeft", { shiftKey: true }));
        expect(document.activeElement).toBe(surface);
        expect(profileTabStops()).toHaveLength(1);
        expect(surface.getAttribute("aria-activedescendant")).toMatch(/^context:/);
    });

    it("keeps movement local until settle and preserves ordinary click activation", async () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        const layer = mock.element.querySelector<SVGGElement>(
            ".profile-lens-context-camera-layer"
        )!;
        const before = layer.getAttribute("transform");

        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 1,
            button: 0,
            clientX: 40,
            clientY: 250
        }));
        surface.dispatchEvent(pointer("pointermove", {
            pointerId: 1,
            clientX: 80,
            clientY: 250
        }));
        expect(mock.selection.select).not.toHaveBeenCalled();
        surface.dispatchEvent(pointer("contextmenu", {
            clientX: 80,
            clientY: 250
        }));
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 1,
            clientX: 80,
            clientY: 250
        }));
        await Promise.resolve();
        surface.dispatchEvent(pointer("click", {
            clientX: 80,
            clientY: 250
        }));
        expect(layer.getAttribute("transform")).not.toBe(before);
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(mock.selection.showContextMenu).not.toHaveBeenCalled();
        expect(mock.tooltip.show).not.toHaveBeenCalled();
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity A");

        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 2,
            button: 0,
            clientX: 56,
            clientY: 250
        }));
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 2,
            clientX: 56,
            clientY: 250
        }));
        surface.dispatchEvent(pointer("click", {
            clientX: 56,
            clientY: 250
        }));
        await Promise.resolve();
        expect(mock.selection.select).toHaveBeenCalledTimes(2);
    });

    it("does not invent a fallback when the probe resolves no feature", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["UNKNOWN", "USA"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                },
                navigation: { enabled: true }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.focus();
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("No Context feature at the center probe");
        expect(mock.element.querySelector(".profile-lens-table")?.textContent)
            .toContain("No data in current report context");
        expect(mock.element.querySelector(".profile-lens-probe-announcement")?.textContent)
            .toContain("no Context feature");
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("suppresses the chart skeleton and renders one bounded empty state with no data", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["UNKNOWN", "USA"],
            bands: ["0 to 17", "18 to 34", "35 to 49"],
            profiles: ["Residents", "Median household income"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                },
                navigation: { enabled: true }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.focus();
        const svg = mock.element.querySelector<SVGSVGElement>("svg.profile-lens-profile-svg")!;
        expect(mock.element.querySelectorAll(".profile-lens-target")).toHaveLength(0);
        expect(svg.getAttribute("data-empty")).toBe("true");
        // The v1.7 orphan skeleton: an axis line, floating band labels and metric captions.
        expect(svg.querySelectorAll("line")).toHaveLength(0);
        expect(svg.querySelectorAll(".profile-lens-chart-layer")).toHaveLength(0);
        expect(svg.querySelectorAll(".profile-lens-label-layer")).toHaveLength(0);
        expect(svg.querySelectorAll(".profile-lens-empty-card")).toHaveLength(1);
        expect(svg.querySelector(".profile-lens-empty")?.getAttribute("aria-hidden")).toBe("true");
        expect((svg.querySelector(".profile-lens-empty-message")?.textContent ?? "").length)
            .toBeGreaterThan(0);
        expect((svg.querySelector(".profile-lens-empty-guidance")?.textContent ?? "").length)
            .toBeGreaterThan(0);
        // Every existing no-data semantic survives beside the card.
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("No Context feature at the center probe");
        expect(mock.element.querySelector(".profile-lens-table")?.textContent)
            .toContain("No data in current report context");
        expect(mock.element.querySelector(".profile-lens-probe-announcement")?.textContent)
            .toContain("no Context feature");
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("restores the chart skeleton once the probe resolves loaded data", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA", "CAN"],
            bands: ["0 to 17", "18 to 34", "35 to 49"],
            profiles: ["Residents"],
            objects: {
                context: { mode: "none" }
            }
        })));
        const svg = mock.element.querySelector<SVGSVGElement>("svg.profile-lens-profile-svg")!;
        expect(mock.element.querySelectorAll(".profile-lens-target").length).toBeGreaterThan(0);
        expect(svg.hasAttribute("data-empty")).toBe(false);
        expect(svg.querySelectorAll(".profile-lens-empty-card")).toHaveLength(0);
    });

    it("labels every arm, not only the first", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA"],
            bands: ["0 to 17", "18 to 34", "35 to 49"],
            profiles: ["Residents", "Median household income", "Degree holders"],
            objects: { context: { mode: "none" } }
        }), { width: 1280, height: 620 }));
        const labels = [...mock.element.querySelectorAll<SVGTextElement>(
            '.profile-lens-label-layer [data-label-kind="band"]'
        )];
        const arms = new Set(labels.map((label) => label.getAttribute("data-label-key")!.split(":")[1]));
        // v1.7 labelled arm 0 only, which left five of six arms on the period page unlabelled.
        expect(arms).toEqual(new Set(["0", "1", "2"]));
        const captions = mock.element.querySelectorAll('[data-label-kind="caption"]');
        expect(captions).toHaveLength(3);
    });

    it("places band labels beside their own band, not at the far edge of the value budget", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA"],
            bands: ["0 to 17", "18 to 34", "35 to 49"],
            profiles: ["Residents"],
            objects: { context: { mode: "none" } }
        }), { width: 1280, height: 620 }));
        const svg = mock.element.querySelector<SVGSVGElement>("svg.profile-lens-profile-svg")!;
        const bars = [...svg.querySelectorAll<SVGRectElement>(".profile-lens-target rect.profile-lens-bar")];
        expect(bars.length).toBeGreaterThan(0);
        const barBottom = Math.max(...bars.map((bar) =>
            Number(bar.getAttribute("y")) + Number(bar.getAttribute("height"))));
        const bandLabels = [...svg.querySelectorAll<SVGTextElement>('[data-label-kind="band"]')];
        expect(bandLabels.length).toBeGreaterThan(0);
        const armGroup = svg.querySelector<SVGGElement>(".profile-lens-arm")!;
        const originY = Number(/translate\([^,]+,([^)]+)\)/.exec(
            armGroup.getAttribute("transform") ?? ""
        )![1]);
        for (const label of bandLabels) {
            // Under v1.7 these sat at valueExtent + 8, roughly 350px below the bars they name.
            expect(Math.abs(Number(label.getAttribute("y")) - (originY + barBottom)))
                .toBeLessThan(40);
        }
    });

    it("shows numbers and a scale annotation at the full tier", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA"],
            bands: ["0 to 17", "18 to 34", "35 to 49"],
            profiles: ["Residents"],
            objects: { context: { mode: "none" } }
        }), { width: 1280, height: 620 }));
        const root = mock.element;
        expect(root.querySelectorAll('[data-label-kind="value"]').length).toBeGreaterThan(0);
        const scale = root.querySelector('[data-label-kind="scale"]');
        expect(scale?.textContent ?? "").toMatch(/^Max /);
    });

    it("names the normalization in the scale annotation when values are proportional", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA"],
            bands: ["0 to 17", "18 to 34", "35 to 49"],
            profiles: ["Residents"],
            objects: {
                context: { mode: "none" },
                data: { normalization: "shareOfProfile" }
            }
        }), { width: 1280, height: 620 }));
        const scale = mock.element.querySelector('[data-label-kind="scale"]');
        expect(scale?.textContent ?? "").toContain("Share of profile");
    });

    it("respects a persisted decision to keep value labels off", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA"],
            bands: ["0 to 17", "18 to 34"],
            profiles: ["Residents"],
            objects: {
                context: { mode: "none" },
                profiles: { showValueLabels: false }
            }
        }), { width: 1280, height: 620 }));
        expect(mock.element.querySelectorAll('[data-label-kind="value"]')).toHaveLength(0);
        expect(mock.element.querySelectorAll(".profile-lens-target").length).toBeGreaterThan(0);
    });

    it("keeps every label inside the chart and free of overlap on a small tile", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA"],
            bands: ["0 to 17", "18 to 34", "35 to 49", "50 to 64", "65 and over"],
            series: ["Urban", "Rural"],
            profiles: ["Residents"],
            objects: { context: { mode: "none" } }
        }), { width: 490, height: 390 }));
        const svg = mock.element.querySelector<SVGSVGElement>("svg.profile-lens-profile-svg")!;
        const layer = svg.querySelector<SVGGElement>(".profile-lens-label-layer")!;
        const cap = Number(layer.getAttribute("data-label-cap"));
        const labels = [...layer.querySelectorAll<SVGTextElement>("text")];
        expect(labels.length).toBeGreaterThan(0);
        expect(labels.length).toBeLessThanOrEqual(cap);
        const boxes = labels.map((label) => {
            const fontSize = Number((label.getAttribute("font-size") ?? "10px").replace("px", ""));
            const width = (label.textContent ?? "").length * fontSize * 0.55;
            const x = Number(label.getAttribute("x"));
            const y = Number(label.getAttribute("y"));
            const anchor = label.getAttribute("text-anchor");
            const x1 = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
            return { x1, x2: x1 + width, y1: y - fontSize * 0.61, y2: y + fontSize * 0.61 };
        });
        // v1.7 rendered "Band 5Band 4Band 3Band 2Band 1" as one unreadable run at this size.
        for (let left = 0; left < boxes.length; left++) {
            for (let right = left + 1; right < boxes.length; right++) {
                const a = boxes[left];
                const b = boxes[right];
                const overlaps = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
                expect(overlaps, `${labels[left].textContent} over ${labels[right].textContent}`)
                    .toBe(false);
            }
        }
    });

    it("contains the focus lens with an inert scrim and aperture", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            // The fitted world camera puts the fixed centre probe over Mali, so binding it is what
            // makes the probe resolve a loaded profile in this harness.
            entities: ["MLI", "USA"],
            bands: ["0 to 17", "18 to 34"],
            profiles: ["Residents"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                },
                layout: { contextLayout: "focusLens" },
                navigation: { enabled: true, fallbackEntityKey: "USA" }
            }
        }), { width: 1280, height: 620 }));
        const svg = mock.element.querySelector<SVGSVGElement>("svg.profile-lens-profile-svg")!;
        const lens = svg.querySelector<SVGGElement>(".profile-lens-lens")!;
        expect(lens).not.toBeNull();
        expect(lens.getAttribute("aria-hidden")).toBe("true");
        expect(lens.getAttribute("pointer-events")).toBe("none");
        expect(lens.querySelectorAll(".profile-lens-lens-scrim")).toHaveLength(1);
        expect(lens.querySelectorAll(".profile-lens-lens-rim")).toHaveLength(1);
        expect(svg.querySelector("#profile-lens-aperture-mask")).not.toBeNull();
        // The lens carries no identity and no target, so picking, selection, tooltips and the
        // accessible table cannot see it.
        expect(lens.querySelectorAll(".profile-lens-target")).toHaveLength(0);
        expect(lens.querySelectorAll("[data-key]")).toHaveLength(0);
        expect(lens.querySelectorAll("[role]")).toHaveLength(0);
        const rim = lens.querySelector(".profile-lens-lens-rim")!;
        const apertureRadius = Number(rim.getAttribute("r"));
        for (const arm of svg.querySelectorAll<SVGGElement>(".profile-lens-arm")) {
            for (const bar of arm.querySelectorAll<SVGRectElement>("rect")) {
                expect(Number(bar.getAttribute("x"))).toBeGreaterThan(apertureRadius);
            }
        }
        // Rounded caps carve the corners out of the drawn shape, so each band carries an invisible
        // rectangle that keeps its interactive area exactly what it was before the restyle.
        const targets = [...svg.querySelectorAll<SVGGElement>(".profile-lens-target")];
        expect(targets.length).toBeGreaterThan(0);
        for (const target of targets) {
            const bar = target.querySelector<SVGRectElement>("rect.profile-lens-bar")!;
            const hitArea = target.querySelector<SVGRectElement>("rect.profile-lens-bar-hit")!;
            expect(hitArea).not.toBeNull();
            expect(hitArea.getAttribute("pointer-events")).toBe("all");
            expect(hitArea.hasAttribute("rx")).toBe(false);
            for (const attribute of ["x", "y", "width", "height"]) {
                expect(hitArea.getAttribute(attribute)).toBe(bar.getAttribute(attribute));
            }
        }
    });

    it("keeps the lens containment through the designed empty state", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            // Bound to nothing the probe can land on, so the frame carries no cells.
            entities: ["ZZA", "ZZB"],
            bands: ["0 to 17", "18 to 34"],
            profiles: ["Residents"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                },
                layout: { contextLayout: "focusLens" },
                navigation: { enabled: true }
            }
        }), { width: 1280, height: 620 }));
        const svg = mock.element.querySelector<SVGSVGElement>("svg.profile-lens-profile-svg")!;
        expect(svg.getAttribute("data-empty")).toBe("true");
        expect(svg.querySelectorAll(".profile-lens-empty-card")).toHaveLength(1);
        // Containment belongs to the composition, not the data. Dropping it here would flash the
        // map between dimmed and live every time the probe crossed empty geography.
        expect(svg.querySelectorAll(".profile-lens-lens")).toHaveLength(1);
        // The orphan skeleton stays suppressed.
        expect(svg.querySelectorAll("line")).toHaveLength(0);
        expect(svg.querySelectorAll(".profile-lens-chart-layer")).toHaveLength(0);
        expect(svg.querySelectorAll(".profile-lens-label-layer")).toHaveLength(0);
    });

    it("leaves the lens treatment inert outside the focus composition", () => {        const { mock, visual } = mount();
        const build = (contextLayout: string) => buildMatrixDataView({
            entities: ["USA", "CAN"],
            bands: ["0 to 17", "18 to 34"],
            profiles: ["Residents"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                },
                layout: { contextLayout },
                navigation: { enabled: true, fallbackEntityKey: "USA" }
            }
        });
        for (const mode of ["split", "locatorInset", "profileOnly"]) {
            visual.update(updateOptions(build(mode), { width: 1280, height: 620 }));
            expect(
                mock.element.querySelectorAll(".profile-lens-lens"),
                `${mode} drew a lens`
            ).toHaveLength(0);
        }
    });

    it("turns the lens off when the author disables it", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["MLI", "USA"],
            bands: ["0 to 17", "18 to 34"],
            profiles: ["Residents"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                },
                layout: { contextLayout: "focusLens" },
                profiles: { showLensScrim: false },
                navigation: { enabled: true, fallbackEntityKey: "USA" }
            }
        }), { width: 1280, height: 620 }));
        expect(mock.element.querySelectorAll(".profile-lens-lens")).toHaveLength(0);
        expect(mock.element.querySelectorAll(".profile-lens-target").length).toBeGreaterThan(0);
    });

    it("keeps series distinguishable without relying on colour alone", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA"],
            bands: ["0 to 17", "18 to 34"],
            series: ["Urban", "Rural"],
            profiles: ["Residents"],
            objects: { context: { mode: "none" } }
        }), { width: 1280, height: 620 }));
        const svg = mock.element.querySelector<SVGSVGElement>("svg.profile-lens-profile-svg")!;
        const pattern = svg.querySelector("#profile-lens-pattern-secondary");
        expect(pattern).not.toBeNull();
        // A rotation-invariant stipple replaces the diagonal hatch that read as noise on rotated
        // arms, and the two series sit on opposite sides of the axis whatever the palette does.
        expect(pattern!.querySelectorAll("circle")).toHaveLength(1);
        expect(pattern!.querySelectorAll("path")).toHaveLength(0);
        const fills = new Set([...svg.querySelectorAll(".profile-lens-target rect.profile-lens-bar")]
            .map((rect) => rect.getAttribute("fill")));
        expect(fills.size).toBeGreaterThan(1);
    });

    it("keeps the label guarantee when the chart renders right to left", () => {
        const { mock, visual } = mount({ locale: "he-IL" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["USA"],
            bands: ["0 to 17", "18 to 34", "35 to 49"],
            profiles: ["Residents", "Median household income", "Degree holders"],
            objects: { context: { mode: "none" } }
        }), { width: 1280, height: 620 }));
        expect(mock.element.querySelector(".profile-lens")?.getAttribute("dir")).toBe("rtl");
        const svg = mock.element.querySelector<SVGSVGElement>("svg.profile-lens-profile-svg")!;
        const labels = [...svg.querySelectorAll<SVGTextElement>(".profile-lens-chart-label")];
        expect(labels.length).toBeGreaterThan(0);
        // Arm captions and scale annotations use an edge anchor, and SVG resolves start/end against
        // direction, so these are the labels an LTR-only box model mispredicts.
        const edgeAnchored = labels.filter((label) => {
            const anchor = label.getAttribute("text-anchor");
            return anchor === "start" || anchor === "end";
        });
        expect(edgeAnchored.length).toBeGreaterThan(0);

        const boxes = labels.map((label) => {
            const fontSize = Number((label.getAttribute("font-size") ?? "10px").replace("px", ""));
            const width = (label.textContent ?? "").length * fontSize * 0.55;
            const x = Number(label.getAttribute("x"));
            const y = Number(label.getAttribute("y"));
            const anchor = label.getAttribute("text-anchor");
            // Resolved the way the browser resolves it under dir="rtl".
            const growsRight = anchor === "end";
            const x1 = anchor === "middle"
                ? x - width / 2
                : growsRight ? x : x - width;
            return { x1, x2: x1 + width, y1: y - fontSize * 0.61, y2: y + fontSize * 0.61 };
        });
        for (let left = 0; left < boxes.length; left++) {
            for (let right = left + 1; right < boxes.length; right++) {
                const a = boxes[left];
                const b = boxes[right];
                const overlaps = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
                expect(overlaps, `${labels[left].textContent} over ${labels[right].textContent}`)
                    .toBe(false);
            }
        }
        const chartX = Number(svg.getAttribute("viewBox")!.split(" ")[0]);
        const chartWidth = Number(svg.getAttribute("width"));
        for (const box of boxes) {
            expect(box.x1).toBeGreaterThanOrEqual(chartX - 1);
            expect(box.x2).toBeLessThanOrEqual(chartX + chartWidth + 1);
        }
    });

    it("removes the lens entirely in high contrast, including its arm geometry", () => {
        const build = (overrides: Record<string, unknown>) => buildMatrixDataView({
            entities: ["MLI", "USA"],
            bands: ["0 to 17", "18 to 34"],
            series: ["Urban", "Rural"],
            profiles: ["Residents"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                },
                layout: { contextLayout: "focusLens" },
                navigation: { enabled: true, fallbackEntityKey: "USA" },
                ...overrides
            }
        });
        const axisStart = (element: HTMLElement): number =>
            Number(element.querySelector(".profile-lens-axis")!.getAttribute("x1"));

        const contrast = mount({ highContrast: true });
        contrast.visual.update(updateOptions(build({}), { width: 1280, height: 620 }));
        const contrastSvg = contrast.mock.element
            .querySelector<SVGSVGElement>("svg.profile-lens-profile-svg")!;
        expect(contrastSvg.querySelectorAll(".profile-lens-target").length).toBeGreaterThan(0);
        expect(contrastSvg.querySelector("#profile-lens-pattern-secondary")!
            .querySelectorAll("path")).toHaveLength(1);
        // Genuinely absent, not merely undimmed: no group, no rim, and no aperture mask. A rim
        // painted in the single host foreground would compete with map geometry drawn in that
        // same colour, and washing out one of the two host colours is what the mode prevents.
        expect(contrastSvg.querySelectorAll(".profile-lens-lens")).toHaveLength(0);
        expect(contrastSvg.querySelectorAll(".profile-lens-lens-scrim")).toHaveLength(0);
        expect(contrastSvg.querySelectorAll(".profile-lens-lens-rim")).toHaveLength(0);
        expect(contrastSvg.querySelector("#profile-lens-aperture-mask")).toBeNull();

        // The aperture is load bearing: it pushes bandStart outward. Suppressing only the paint
        // would still move every arm, so the geometry has to match the no-lens composition exactly
        // and differ from the lens composition.
        const disabled = mount();
        disabled.visual.update(updateOptions(
            build({ profiles: { showLensScrim: false } }),
            { width: 1280, height: 620 }
        ));
        const enabled = mount();
        enabled.visual.update(updateOptions(build({}), { width: 1280, height: 620 }));
        const enabledSvg = enabled.mock.element
            .querySelector<SVGSVGElement>("svg.profile-lens-profile-svg")!;
        expect(enabledSvg.querySelectorAll(".profile-lens-lens-rim")).toHaveLength(1);

        expect(axisStart(contrast.mock.element)).toBeCloseTo(axisStart(disabled.mock.element), 6);
        expect(axisStart(contrast.mock.element)).toBeLessThan(axisStart(enabled.mock.element));
    });

    it("restores ordinary Entity focus when Context is removed", () => {
        const { mock, visual } = mount();
        const build = (mode: "builtInPack" | "none") => buildMatrixDataView({
            entities: ["UNKNOWN", "USA"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: {
                    mode,
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                }
            }
        });
        visual.update(updateOptions(build("builtInPack")));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("No Context feature at the center probe");
        visual.update(updateOptions(build("none")));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("UNKNOWN");
        expect(mock.element.querySelectorAll(".profile-lens-target").length).toBeGreaterThan(0);
        expect(mock.element.querySelector(".profile-lens-table")?.textContent)
            .not.toContain("No data in current report context");
        expect(mock.element.querySelector(".profile-lens-status")?.getAttribute("role"))
            .toBe("status");
        expect(mock.element.querySelector(".profile-lens-status")?.getAttribute("aria-live"))
            .toBe("polite");
    });

    it("does not revive a stale render session after the DataView becomes non-renderable", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: { context: { mode: "grid" } }
        })));
        visual.update(updateOptions(buildMatrixDataView({
            entities: [],
            bands: ["Band 1"],
            profiles: ["Metric A"]
        })));
        expect(mock.element.querySelector(".profile-lens-header")?.hasAttribute("hidden")).toBe(true);
        expect(mock.element.querySelector(".profile-lens-landing")?.hasAttribute("hidden"))
            .toBe(false);
        mock.selection.onSelectCallback?.([mockSelectionId("|node:entity:0")]);
        expect(mock.element.querySelector(".profile-lens-header")?.hasAttribute("hidden")).toBe(true);
        expect(mock.element.querySelector(".profile-lens-landing")?.hasAttribute("hidden"))
            .toBe(false);
        expect(mock.element.querySelectorAll(".profile-lens-target")).toHaveLength(0);
    });

    it("uses an exact loaded fallback only for no-feature without selecting it", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["WLD", "USA"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                },
                navigation: {
                    fallbackEntityKey: "WLD"
                }
            }
        })));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent).toBe("WLD");
        expect(mock.element.querySelector(".profile-lens-header-subtitle")?.textContent)
            .toContain("Showing configured fallback Entity");
        expect(mock.element.querySelector(".profile-lens-table")?.textContent)
            .not.toContain("No data in current report context");
        expect(mock.selection.select).not.toHaveBeenCalled();
        expect(mock.element.querySelectorAll(".profile-lens-context-outline")).toHaveLength(0);
        expect(mock.element.querySelector(".profile-lens-context")
            ?.getAttribute("aria-activedescendant")).toBeNull();
        expect(mock.element.querySelector(".profile-lens-probe-announcement")?.textContent)
            .toContain("configured fallback Entity WLD");
    });

    it("does not let fallback mask a known no-data backdrop feature", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["WLD", "USA"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    packKeyMode: "canonical"
                },
                navigation: { fallbackEntityKey: "WLD" },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.focus();
        surface.dispatchEvent(key("keydown", "Enter"));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .not.toBe("WLD");
        expect(mock.element.querySelector(".profile-lens-table")?.textContent)
            .toContain("No data in current report context");
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("clears profile values and suppresses settle selection for unloaded detail", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: [
                "Entity A", "Entity B", "Entity C",
                "Entity D", "Entity E", "Entity F",
                "Entity G", "Entity H", "Entity I"
            ],
            unloadedEntityIndexes: [4],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.focus();
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity E");
        expect(mock.element.querySelector(".profile-lens-header-subtitle")?.textContent)
            .toContain("not loaded");
        expect(mock.element.querySelector(".profile-lens-table")?.textContent)
            .toContain("not loaded");
        expect(mock.element.querySelector(".profile-lens-status-summary")?.textContent)
            .toContain("not loaded");
        expect(mock.element.querySelector(".profile-lens-status-summary")?.textContent)
            .not.toContain("No data in current report context");
        expect(mock.element.querySelector(".profile-lens-probe-announcement")?.textContent)
            .toContain("not loaded");
        surface.dispatchEvent(key("keydown", "ArrowLeft", { shiftKey: true }));
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("restores unloaded probe presentation after a lifecycle resize", () => {
        const { mock, visual } = mount();
        const view = buildMatrixDataView({
            entities: [
                "Entity A", "Entity B", "Entity C",
                "Entity D", "Entity E", "Entity F",
                "Entity G", "Entity H", "Entity I"
            ],
            unloadedEntityIndexes: [4],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: { context: { mode: "grid" } }
        });
        visual.update(updateOptions(view, { width: 800, height: 600 }));
        expect(mock.element.querySelector(".profile-lens-header-subtitle")?.textContent)
            .toContain("not loaded");
        visual.update(updateOptions(view, { width: 1000, height: 700 }));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity E");
        expect(mock.element.querySelector(".profile-lens-header-subtitle")?.textContent)
            .toContain("not loaded");
        expect(mock.element.querySelector(".profile-lens-table")?.textContent)
            .toContain("not loaded");
    });

    it("reasserts probe focus after explicit spatial browsing when the camera next moves", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                interaction: { mode: "localOnly" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        surface.focus();
        const probeTitle = mock.element.querySelector(".profile-lens-header-title")?.textContent;
        surface.dispatchEvent(key("keydown", "ArrowUp"));
        const browsedTitle = mock.element.querySelector(".profile-lens-header-title")?.textContent;
        expect(browsedTitle).not.toBe(probeTitle);
        surface.dispatchEvent(key("keydown", "+"));
        const restoredTitle =
            mock.element.querySelector(".profile-lens-header-title")?.textContent;
        expect(restoredTitle).not.toBe(browsedTitle);
        expect(mock.element.querySelector(".profile-lens-probe-announcement")?.textContent)
            .toContain(restoredTitle);
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("does not run a redundant partial profile render when full focus already matches", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        expect(contextMetrics(surface).profilePartialUpdates).toBe(0);
        expect(mock.element.querySelectorAll(".profile-lens-target").length).toBeGreaterThan(0);
    });

    it("activates the current probed Entity after keyboard camera movement", async () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.focus();
        surface.dispatchEvent(key("keydown", "+"));
        surface.dispatchEvent(key("keydown", "+"));
        surface.dispatchEvent(key("keydown", "ArrowLeft", { shiftKey: true }));
        await Promise.resolve();
        await Promise.resolve();
        const currentTitle =
            mock.element.querySelector(".profile-lens-header-title")?.textContent ?? "";
        mock.selection.select.mockClear();
        surface.dispatchEvent(key("keydown", "Enter"));
        await Promise.resolve();
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe(currentTitle);
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        const identity = mock.selection.select.mock.calls[0][0] as { getKey: () => string };
        expect(identity.getKey()).toContain(
            `entity:${["Entity A", "Entity B", "Entity C", "Entity D"].indexOf(currentTitle)}`
        );
    });

    it("keeps external Entity selection as an overlay without taking over probe focus", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                interaction: { mode: "localOnly" }
            }
        })));
        const title = mock.element.querySelector(".profile-lens-header-title")?.textContent;
        mock.selection.onSelectCallback?.([mockSelectionId("|node:entity:0")]);
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent).toBe(title);
        expect(mock.element.querySelectorAll(".profile-lens-context-outline").length)
            .toBeGreaterThanOrEqual(2);
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("updates probe focus without rebuilding provider, scene, geometry, or picking", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                interaction: { mode: "localOnly" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.focus();
        const initialTitle = mock.element.querySelector(".profile-lens-header-title")?.textContent;
        const before = { ...contextMetrics(surface) };
        surface.dispatchEvent(key("keydown", "+"));
        surface.dispatchEvent(key("keydown", "+"));
        for (let index = 0; index < 6; index++) {
            surface.dispatchEvent(key("keydown", "ArrowLeft", { shiftKey: true }));
        }
        const after = contextMetrics(surface);
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .not.toBe(initialTitle);
        expect(after.providerBuilds).toBe(before.providerBuilds);
        expect(after.sceneBuilds).toBe(before.sceneBuilds);
        expect(after.sceneIndexBuilds).toBe(before.sceneIndexBuilds);
        expect(after.svgGeometryBuilds).toBe(before.svgGeometryBuilds);
        expect(after.canvasRasterBuilds).toBe(before.canvasRasterBuilds);
        expect(after.canvasPickingBuilds).toBe(before.canvasPickingBuilds);
        expect(after.profilePartialUpdates).toBeGreaterThan(before.profilePartialUpdates);
        expect(after.profilePartialUpdates - before.profilePartialUpdates)
            .toBeLessThan(after.probeResolutions - before.probeResolutions);
        expect(mock.element.querySelector(".profile-lens-status")?.getAttribute("role"))
            .toBe("group");
        expect(mock.element.querySelector(".profile-lens-status")?.getAttribute("aria-live"))
            .toBe("off");
        expect(mock.element.querySelector(".profile-lens-probe-announcement")?.getAttribute("role"))
            .toBe("status");
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("serializes and coalesces rapid deferred A-B-A Entity selections", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        surface.focus();
        surface.dispatchEvent(key("keydown", "Enter"));
        surface.dispatchEvent(key("keydown", "ArrowRight"));
        surface.dispatchEvent(key("keydown", "Enter"));
        surface.dispatchEvent(key("keydown", "ArrowLeft"));
        surface.dispatchEvent(key("keydown", "Enter"));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(mock.selection.pending).toHaveLength(1);
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity A");

        mock.selection.resolvePending(0);
        await Promise.resolve();
        await Promise.resolve();

        const metrics = contextMetrics(surface);
        expect(metrics.hostSelectionStale).toBe(0);
        expect(metrics.hostSelectionResolved).toBe(1);
        expect(metrics.hostSelectionCoalesced).toBeGreaterThanOrEqual(2);
        expect(metrics.maxHostSelectionInFlight).toBe(1);
        expect(mock.selection.pending).toHaveLength(0);
        expect(mock.selection.selected[0]?.getKey()).toContain("entity:0");
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity A");
    });

    it("serializes profile-mark then Context Entity selection", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false },
                interaction: { mode: "reportSelection" }
            }
        })));
        mock.element.querySelector<HTMLElement>(".profile-lens-target")
            ?.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(mock.selection.pending).toHaveLength(1);

        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        surface.focus();
        surface.dispatchEvent(key("keydown", "ArrowRight"));
        surface.dispatchEvent(key("keydown", "Enter"));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(mock.selection.pending).toHaveLength(1);

        mock.selection.resolvePending();
        await Promise.resolve();
        await Promise.resolve();
        expect(mock.selection.select).toHaveBeenCalledTimes(2);
        expect(mock.selection.pending).toHaveLength(1);
        mock.selection.resolvePending();
        await Promise.resolve();
        await Promise.resolve();

        expect(mock.selection.pending).toHaveLength(0);
        expect(mock.selection.selected).toHaveLength(1);
        expect(mock.selection.selected[0]?.getKey()).toContain("entity:1");
        expect(contextMetrics(surface).maxHostSelectionInFlight).toBe(1);
    });

    it("preserves queued explicit profile multi-select operations", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1", "Band 2"],
            profiles: ["Metric A"]
        })));
        const targets = mock.element.querySelectorAll<HTMLElement>(".profile-lens-target");
        targets[0]?.dispatchEvent(pointer("click", {
            clientX: 10,
            clientY: 10,
            ctrlKey: true
        }));
        targets[1]?.dispatchEvent(pointer("click", {
            clientX: 20,
            clientY: 10,
            ctrlKey: true
        }));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(mock.selection.pending).toHaveLength(1);

        mock.selection.resolvePending();
        await Promise.resolve();
        await Promise.resolve();
        expect(mock.selection.select).toHaveBeenCalledTimes(2);
        expect(mock.selection.pending).toHaveLength(1);
        mock.selection.resolvePending();
        await Promise.resolve();
        await Promise.resolve();

        expect(mock.selection.selected).toHaveLength(2);
        expect(mock.selection.select.mock.calls.every((call) => call[1] === true)).toBe(true);
    });

    it("continues with the latest queued selection after a rejected call", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        surface.focus();
        surface.dispatchEvent(key("keydown", "Enter"));
        surface.dispatchEvent(key("keydown", "ArrowRight"));
        surface.dispatchEvent(key("keydown", "Enter"));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);

        mock.selection.rejectPending();
        await Promise.resolve();
        await Promise.resolve();
        expect(mock.selection.select).toHaveBeenCalledTimes(2);
        mock.selection.resolvePending();
        await Promise.resolve();
        await Promise.resolve();

        expect(mock.selection.selected[0]?.getKey()).toContain("entity:1");
        expect(contextMetrics(surface)).toMatchObject({
            hostSelectionRejected: 1,
            hostSelectionResolved: 1,
            maxHostSelectionInFlight: 1
        });
    });

    it("invalidates queued local selection after an external callback", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        surface.focus();
        surface.dispatchEvent(key("keydown", "Enter"));
        surface.dispatchEvent(key("keydown", "ArrowRight"));
        surface.dispatchEvent(key("keydown", "Enter"));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);

        const external = mockSelectionId("|node:entity:2");
        mock.selection.emitExternal([external]);
        mock.selection.rejectPending();
        await Promise.resolve();
        await Promise.resolve();

        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(mock.selection.pending).toHaveLength(0);
        expect(mock.selection.selected[0]?.getKey()).toContain("entity:2");
        expect(contextMetrics(surface).hostSelectionExternalInvalidations).toBe(1);
        expect(contextMetrics(surface).hostSelectionRejected).toBe(1);
        expect(mock.element.querySelector('[data-code="hostSelectionRejected"]')).not.toBeNull();
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity B");
    });

    it("invalidates queued work even when external selection matches the in-flight identity", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        surface.focus();
        surface.dispatchEvent(key("keydown", "Enter"));
        surface.dispatchEvent(key("keydown", "ArrowRight"));
        surface.dispatchEvent(key("keydown", "Enter"));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);

        const externalA = mockSelectionId("|node:entity:0");
        mock.selection.emitExternal([externalA]);
        mock.selection.resolvePending();
        await Promise.resolve();
        await Promise.resolve();

        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(mock.selection.pending).toHaveLength(0);
        expect(mock.selection.selected[0]?.getKey()).toContain("entity:0");
        expect(contextMetrics(surface).hostSelectionExternalInvalidations).toBe(1);
    });

    it("reconciles stale successful local selection from the host without changing local focus", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        surface.focus();
        surface.dispatchEvent(key("keydown", "Enter"));
        surface.dispatchEvent(key("keydown", "ArrowRight"));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity B");
        mock.selection.emitExternal([mockSelectionId("|node:entity:2")]);
        const before = contextMetrics(surface).profilePartialUpdates;

        mock.selection.resolvePending();
        await Promise.resolve();
        await Promise.resolve();

        expect(mock.selection.selected[0]?.getKey()).toContain("entity:0");
        expect(mock.element.querySelector("[id='context:entity:0']")
            ?.getAttribute("aria-selected")).toBe("true");
        expect(mock.element.querySelector("[id='context:entity:2']")
            ?.getAttribute("aria-selected")).toBe("false");
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity B");
        expect(contextMetrics(surface).profilePartialUpdates).toBe(before + 1);
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        expect(contextMetrics(surface).profilePartialUpdates).toBe(before + 1);
    });

    it("keeps external host selection when stale success does not change host state", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        surface.focus();
        surface.dispatchEvent(key("keydown", "Enter"));
        surface.dispatchEvent(key("keydown", "ArrowRight"));
        mock.selection.emitExternal([mockSelectionId("|node:entity:2")]);
        mock.selection.resolvePending(0, false);
        await Promise.resolve();
        await Promise.resolve();

        expect(mock.selection.selected[0]?.getKey()).toContain("entity:2");
        expect(mock.element.querySelector("[id='context:entity:2']")
            ?.getAttribute("aria-selected")).toBe("true");
        expect(mock.element.querySelector("[id='context:entity:0']")
            ?.getAttribute("aria-selected")).toBe("false");
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity B");
    });

    it("reconciles stale multi-selection success without taking over probe focus", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        surface.focus();
        surface.dispatchEvent(key("keydown", "Enter", { ctrlKey: true }));
        surface.dispatchEvent(key("keydown", "ArrowRight"));
        mock.selection.emitExternal([
            mockSelectionId("|node:entity:2"),
            mockSelectionId("|node:entity:3")
        ]);
        mock.selection.resolvePending();
        await Promise.resolve();
        await Promise.resolve();

        expect(mock.selection.selected.map((id) => id.getKey()).sort()).toEqual([
            "|node:entity:0",
            "|node:entity:2",
            "|node:entity:3"
        ]);
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity B");
        expect(contextMetrics(surface).maxHostSelectionInFlight).toBe(1);
    });

    it("does not rerender or rebind after a deferred selection completes post-destroy", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            profiles: ["Metric A"]
        })));
        const target = mock.element.querySelector<HTMLElement>(".profile-lens-target")!;
        target.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        visual.destroy();
        mock.selection.resolvePending();
        await Promise.resolve();
        await Promise.resolve();
        mock.element.querySelector<HTMLElement>(".profile-lens")
            ?.dispatchEvent(pointer("contextmenu", { clientX: 5, clientY: 5 }));
        target.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
        mock.element.querySelector<HTMLElement>(".profile-lens-entity-option")
            ?.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
        mock.element.querySelector<HTMLElement>(".profile-lens")
            ?.dispatchEvent(pointer("contextmenu", { clientX: 5, clientY: 5 }));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(mock.selection.showContextMenu).not.toHaveBeenCalled();
    });

    it("surfaces a rejected host selection without changing local focus or retrying", async () => {
        const { mock, visual } = mount({ selectionBehavior: "reject" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: false },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        surface.focus();
        surface.dispatchEvent(key("keydown", "Enter"));
        await Promise.resolve();
        await Promise.resolve();
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(contextMetrics(surface).hostSelectionRejected).toBe(1);
        expect(mock.element.querySelector('[data-code="hostSelectionRejected"]')).not.toBeNull();
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Entity A");
        visual.update(updateOptions(undefined, { width: 900, height: 700 }));
        expect(mock.element.querySelector('[data-code="hostSelectionRejected"]')).not.toBeNull();
    });

    it("does not turn a rejected drag settle into a synthetic-click retry", async () => {
        const { mock, visual } = mount({ selectionBehavior: "reject" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true },
                interaction: { mode: "reportSelection" },
                diagnostics: { showDiagnostics: false }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 71,
            button: 0,
            clientX: 120,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointermove", {
            pointerId: 71,
            clientX: 160,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 71,
            clientX: 160,
            clientY: 150
        }));
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mock.element.querySelector(".profile-lens-status")?.getAttribute("role"))
            .toBe("status");
        expect(mock.element.querySelector(".profile-lens-status")?.getAttribute("aria-live"))
            .toBe("polite");
        expect(mock.element.querySelector(".profile-lens-status-summary")?.textContent)
            .toContain("Power BI rejected the selection");
        expect(mock.element.querySelector('[data-code="hostSelectionRejected"]')).toBeNull();
        surface.dispatchEvent(pointer("click", {
            clientX: 160,
            clientY: 150
        }));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(contextMetrics(surface).hostSelectionRejected).toBe(1);
    });

    it("keeps the camera and scene build stable across local focus and selection rerenders", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            periods: ["2025", "2026"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 1,
            button: 0,
            clientX: 80,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointermove", {
            pointerId: 1,
            clientX: 96,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 1,
            clientX: 96,
            clientY: 150
        }));
        const transform = mock.element.querySelector(
            ".profile-lens-context-camera-layer"
        )?.getAttribute("transform");
        const beforeMetrics = { ...contextMetrics(surface) };

        surface.focus();
        surface.dispatchEvent(key("keydown", "ArrowRight"));
        expect(mock.element.querySelector(".profile-lens-context-camera-layer")
            ?.getAttribute("transform")).toBe(transform);
        const period = mock.element.querySelector<HTMLElement>(".profile-lens-period-slider");
        period?.dispatchEvent(key("keydown", "ArrowRight"));
        expect(mock.element.querySelector(".profile-lens-context-camera-layer")
            ?.getAttribute("transform")).toBe(transform);
        mock.selection.onSelectCallback?.([mockSelectionId("|node:entity:0")]);
        expect(mock.element.querySelector(".profile-lens-context-camera-layer")
            ?.getAttribute("transform")).toBe(transform);
        const afterMetrics = contextMetrics(surface);
        expect(afterMetrics.sceneBuilds).toBe(beforeMetrics.sceneBuilds);
        expect(afterMetrics.svgGeometryBuilds).toBe(beforeMetrics.svgGeometryBuilds);
        expect(afterMetrics.cameraFrames).toBe(beforeMetrics.cameraFrames);

        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            periods: ["2025", "2026"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "hex" },
                navigation: { enabled: true }
            }
        })));
        expect(mock.element.querySelector(".profile-lens-context-camera-layer")
            ?.getAttribute("transform")).toBe("matrix(1,0,0,1,0,0)");
    });

    it("preserves zoom through valid resize and resets after an invalid transition", () => {
        const { mock, visual } = mount();
        const view = buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true }
            }
        });

        visual.update(updateOptions(view, { width: 640, height: 480 }));
        let surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.dispatchEvent(key("keydown", "+"));
        surface.dispatchEvent(key("keydown", "ArrowLeft", { shiftKey: true }));
        const before = mock.element.querySelector(".profile-lens-context-camera-layer")
            ?.getAttribute("transform") ?? "";
        const beforeZoom = Number(before.match(/matrix\(([^,]+)/)?.[1]);
        const sceneBuilds = contextMetrics(surface).sceneBuilds;

        visual.update(updateOptions(view, { width: 900, height: 620 }));
        surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        const after = mock.element.querySelector(".profile-lens-context-camera-layer")
            ?.getAttribute("transform") ?? "";
        const afterZoom = Number(after.match(/matrix\(([^,]+)/)?.[1]);
        expect(afterZoom).toBeCloseTo(beforeZoom, 12);
        expect(after).not.toBe("matrix(1,0,0,1,0,0)");
        expect(contextMetrics(surface).sceneBuilds).toBe(sceneBuilds);

        visual.update(updateOptions(view, { width: 0, height: 0 }));
        visual.update(updateOptions(view, { width: 640, height: 480 }));
        expect(mock.element.querySelector(".profile-lens-context-camera-layer")
            ?.getAttribute("transform")).toBe("matrix(1,0,0,1,0,0)");
    });

    it("applies Automatic Fill to geographic home while explicit Fit retains the full extent", () => {
        const { mock, visual } = mount();
        const view = (homeView: "automatic" | "fit" | "fill") => buildMatrixDataView({
            entities: ["USA", "CAN", "MEX"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "worldCountries",
                    worldDetail: "50m",
                    packKeyMode: "canonical"
                },
                layout: { contextLayout: "focusLens" },
                navigation: { enabled: "auto", homeView }
            }
        });
        visual.update(updateOptions(view("automatic"), { width: 1280, height: 620 }));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        const automatic = { ...contextMetrics(surface) };
        expect(automatic.homeZoom).toBeGreaterThan(1);
        expect(automatic.cameraZoom).toBeCloseTo(automatic.homeZoom, 12);

        visual.update(updateOptions(view("automatic"), { width: 900, height: 700 }));
        const resizedHome = { ...contextMetrics(surface) };
        expect(resizedHome.cameraZoom).toBeCloseTo(resizedHome.homeZoom, 12);
        expect(resizedHome.homeZoom).not.toBe(automatic.homeZoom);

        visual.update(updateOptions(view("fit"), { width: 900, height: 700 }));
        expect(contextMetrics(surface).homeZoom).toBe(1);
        expect(contextMetrics(surface).cameraZoom).toBe(1);

        visual.update(updateOptions(view("fill"), { width: 1280, height: 620 }));
        const fill = { ...contextMetrics(surface) };
        expect(fill.homeZoom).toBeGreaterThan(1);
        surface.dispatchEvent(key("keydown", "-"));
        expect(contextMetrics(surface).cameraZoom).toBeLessThan(fill.homeZoom);
        surface.dispatchEvent(key("keydown", "Home"));
        expect(contextMetrics(surface).cameraZoom).toBeCloseTo(fill.homeZoom, 12);
    });

    it("zooms by wheel, keyboard, and pinch with probe-driven local focus", () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: {
                        enabled: true,
                        showCenterProbe: true,
                        showResetControl: true,
                        showGestureHelp: true
                    },
                    interaction: { mode: "localOnly" }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            const wheel = pointer("wheel", {
                deltaY: -100,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            });
            surface.dispatchEvent(wheel);
            expect(wheel.defaultPrevented).toBe(true);
            expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
            expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
            const afterWheel = mock.element.querySelector(
                ".profile-lens-context-camera-layer"
            )?.getAttribute("transform");
            expect(afterWheel).not.toBe("matrix(1,0,0,1,0,0)");

            surface.dispatchEvent(key("keydown", "+"));
            expect(mock.element.querySelector(".profile-lens-context-camera-layer")
                ?.getAttribute("transform")).not.toBe(afterWheel);
            surface.dispatchEvent(key("keydown", "Home"));
            expect(mock.element.querySelector(".profile-lens-context-camera-layer")
                ?.getAttribute("transform")).toBe("matrix(1,0,0,1,0,0)");

            surface.dispatchEvent(pointer("pointerdown", {
                pointerId: 11,
                pointerType: "touch",
                button: 0,
                clientX: 100,
                clientY: 150
            }));
            surface.dispatchEvent(pointer("pointerdown", {
                pointerId: 12,
                pointerType: "touch",
                button: 0,
                clientX: 200,
                clientY: 150
            }));
            surface.dispatchEvent(pointer("pointermove", {
                pointerId: 12,
                pointerType: "touch",
                clientX: 240,
                clientY: 150
            }));
            surface.dispatchEvent(pointer("pointerup", {
                pointerId: 12,
                pointerType: "touch",
                clientX: 240,
                clientY: 150
            }));
            surface.dispatchEvent(pointer("pointerup", {
                pointerId: 11,
                pointerType: "touch",
                clientX: 100,
                clientY: 150
            }));
            expect(mock.element.querySelector(".profile-lens-context-camera-layer")
                ?.getAttribute("transform")).not.toBe("matrix(1,0,0,1,0,0)");
            expect(["Entity A", "Entity B"]).toContain(
                mock.element.querySelector(".profile-lens-header-title")?.textContent
            );
            expect(mock.selection.select).not.toHaveBeenCalled();
            expect(mock.element.querySelector(".profile-lens-context-probe")).not.toBeNull();
            expect(surface.getAttribute("aria-description")).toContain("updates the local profile");
            expect(surface.getAttribute("aria-keyshortcuts")).toContain("Shift+ArrowLeft");
            expect(mock.element.querySelector(".profile-lens-context-reset")
                ?.getAttribute("tabindex")).toBe("-1");

            vi.advanceTimersByTime(250);
            expect(vi.getTimerCount()).toBe(0);
            expect(contextMetrics(surface).moveEnds).toBeGreaterThan(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("rebases two-pointer pinch to one-pointer pan without a camera jump", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 21,
            pointerType: "touch",
            button: 0,
            clientX: 100,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 22,
            pointerType: "touch",
            button: 0,
            clientX: 200,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointermove", {
            pointerId: 22,
            pointerType: "touch",
            clientX: 240,
            clientY: 170
        }));
        const pinched = cameraValues(surface);
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 22,
            pointerType: "touch",
            clientX: 240,
            clientY: 170
        }));
        expect(cameraValues(surface)).toEqual(pinched);

        surface.dispatchEvent(pointer("pointermove", {
            pointerId: 21,
            pointerType: "touch",
            clientX: 110,
            clientY: 155
        }));
        const rebased = cameraValues(surface);
        expect(rebased[0]).toBeCloseTo(pinched[0], 12);
        expect(rebased[3]).toBeCloseTo(pinched[3], 12);
        expect(rebased[4] - pinched[4]).toBeGreaterThanOrEqual(0);
        expect(rebased[4] - pinched[4]).toBeLessThanOrEqual(10);
        expect(rebased[5] - pinched[5]).toBeGreaterThanOrEqual(0);
        expect(rebased[5] - pinched[5]).toBeLessThanOrEqual(5);
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 21,
            pointerType: "touch",
            clientX: 110,
            clientY: 155
        }));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(contextMetrics(surface).moveEnds).toBe(1);
    });

    it("does not commit a touch gesture that never changes the camera", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        const before = contextMetrics(surface).moveEnds;
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 31,
            pointerType: "touch",
            button: 0,
            clientX: 100,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 32,
            pointerType: "touch",
            button: 0,
            clientX: 200,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 32,
            pointerType: "touch",
            clientX: 200,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 31,
            pointerType: "touch",
            clientX: 100,
            clientY: 150
        }));
        expect(contextMetrics(surface).moveEnds).toBe(before);
        expect(mock.selection.select).not.toHaveBeenCalled();
    });

    it("contains clamped wheel input without a no-op settle commit", () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true, minZoom: 7.3, maxZoom: 7.3 }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            let bubbled = 0;
            mock.element.addEventListener("wheel", () => {
                bubbled++;
            });
            const before = { ...contextMetrics(surface) };
            const atMinimum = pointer("wheel", {
                deltaY: 120,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            });
            const atMaximum = pointer("wheel", {
                deltaY: -120,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            });
            surface.dispatchEvent(atMinimum);
            surface.dispatchEvent(atMaximum);
            expect(atMinimum.defaultPrevented).toBe(false);
            expect(atMaximum.defaultPrevented).toBe(false);
            expect(bubbled).toBe(2);
            expect(contextMetrics(surface).cameraFrames).toBe(before.cameraFrames);
            // A clamped camera leaves the wheel event untouched: no default suppression and no
            // settle commit, so the report page keeps scrolling.
            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(120);
            expect(contextMetrics(surface).moveEnds - before.moveEnds).toBe(0);
            expect(mock.selection.select).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);

            const zero = pointer("wheel", {
                deltaY: 0,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            });
            const invalid = pointer("wheel", {
                deltaY: Number.NaN,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            });
            surface.dispatchEvent(zero);
            surface.dispatchEvent(invalid);
            expect(zero.defaultPrevented).toBe(false);
            expect(invalid.defaultPrevented).toBe(false);
            expect(bubbled).toBe(4);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("releases clamped-direction wheel ticks to the page mid-gesture", () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true, maxZoom: 1.2 },
                    interaction: { mode: "reportSelection" }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            let handled = 0;
            let released = 0;
            // Observed on the surface itself: same-node listeners still run after
            // stopPropagation(), so prevented (effective) ticks are visible here too.
            surface.addEventListener("wheel", (event) => {
                if ((event as WheelEvent).defaultPrevented) {
                    handled++;
                } else {
                    released++;
                }
            });
            const wheelAt = (deltaY: number) => surface.dispatchEvent(pointer("wheel", {
                deltaY,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            }));
            const before = contextMetrics(surface).moveEnds;
            // Zoom in until the camera hits its ceiling: the first clamped tick arrives
            // un-prevented while the previous ticks were all handled.
            let guard = 0;
            while (guard++ < 60 && released === 0) {
                wheelAt(-120);
            }
            expect(handled).toBeGreaterThan(0);
            const framesAtClamp = contextMetrics(surface).cameraFrames;
            // Momentum-style burst past the ceiling: every tick must stay un-prevented and none
            // may nudge the camera further.
            for (let index = 0; index < 8; index++) {
                wheelAt(-120);
            }
            expect(contextMetrics(surface).cameraFrames).toBe(framesAtClamp);
            expect(released).toBe(9);
            expect(handled + released).toBeLessThanOrEqual(68);
            // The first clamped tick ends the gesture synchronously: the settle commit lands
            // before any timer advances, so later clamped ticks reach the page immediately.
            expect(contextMetrics(surface).moveEnds - before).toBe(1);
            vi.advanceTimersByTime(500);
            expect(mock.selection.select).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each([
        ["drag", 1, 1],
        ["click", 0, 1],
        ["arrow", 0, 0],
        ["pinch", 1, 1],
        ["home", 1, 1],
        ["rebind", 0, 0],
        ["disable", 0, 0],
        ["cancel", 0, 0],
        ["profilePress", 0, 0],
        ["resetPress", 0, 0],
        ["destroy", 0, 0]
    ] as const)(
        "cancels stale wheel settle before %s",
        (action, expectedMoveEnds, expectedSelections) => {
            vi.useFakeTimers();
            try {
                const { mock, visual } = mount();
                const view = buildMatrixDataView({
                    entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
                    bands: ["Band 1"],
                    profiles: ["Metric A"],
                    objects: {
                        context: { mode: "grid" },
                        navigation: { enabled: true },
                        interaction: { mode: "reportSelection" }
                    }
                });
                visual.update(updateOptions(view));
                const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
                setSurfaceBounds(surface, 320, 300);
                const beforeMoveEnds = contextMetrics(surface).moveEnds;
                surface.dispatchEvent(pointer("wheel", {
                    deltaY: -120,
                    deltaMode: 0,
                    clientX: 160,
                    clientY: 150
                }));

                if (action === "drag") {
                    surface.dispatchEvent(pointer("pointerdown", {
                        pointerId: 101,
                        button: 0,
                        clientX: 120,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointermove", {
                        pointerId: 101,
                        clientX: 160,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointerup", {
                        pointerId: 101,
                        clientX: 160,
                        clientY: 150
                    }));
                } else if (action === "click") {
                    surface.dispatchEvent(pointer("click", {
                        clientX: 40,
                        clientY: 250
                    }));
                } else if (action === "arrow") {
                    surface.focus();
                    surface.dispatchEvent(key("keydown", "ArrowLeft"));
                } else if (action === "pinch") {
                    surface.dispatchEvent(pointer("pointerdown", {
                        pointerId: 102,
                        pointerType: "touch",
                        button: 0,
                        clientX: 100,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointerdown", {
                        pointerId: 103,
                        pointerType: "touch",
                        button: 0,
                        clientX: 200,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointermove", {
                        pointerId: 103,
                        pointerType: "touch",
                        clientX: 240,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointerup", {
                        pointerId: 103,
                        pointerType: "touch",
                        clientX: 240,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointerup", {
                        pointerId: 102,
                        pointerType: "touch",
                        clientX: 100,
                        clientY: 150
                    }));
                } else if (action === "home") {
                    surface.focus();
                    surface.dispatchEvent(key("keydown", "Home"));
                } else if (action === "rebind") {
                    visual.update(updateOptions(view, { width: 900, height: 700 }));
                } else if (action === "disable") {
                    (mock.host.hostCapabilities as { allowInteractions: boolean })
                        .allowInteractions = false;
                    visual.update(updateOptions(undefined));
                } else if (action === "cancel") {
                    surface.dispatchEvent(pointer("pointerdown", {
                        pointerId: 104,
                        button: 0,
                        clientX: 160,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointercancel", {
                        pointerId: 104,
                        clientX: 160,
                        clientY: 150
                    }));
                } else if (action === "profilePress") {
                    mock.element.querySelector<HTMLElement>(".profile-lens-target")
                        ?.dispatchEvent(pointer("pointerdown", {
                            pointerId: 105,
                            button: 0,
                            clientX: 10,
                            clientY: 10
                        }));
                } else if (action === "resetPress") {
                    mock.element.querySelector<HTMLElement>(".profile-lens-context-reset")
                        ?.dispatchEvent(pointer("pointerdown", {
                            pointerId: 106,
                            button: 0,
                            clientX: 10,
                            clientY: 10
                        }));
                } else {
                    visual.destroy();
                }

                const moveEndsAfterAction = contextMetrics(surface).moveEnds;
                const selectionsAfterAction = mock.selection.select.mock.calls.length;
                vi.advanceTimersByTime(500);
                expect(contextMetrics(surface).moveEnds - beforeMoveEnds)
                    .toBe(expectedMoveEnds);
                expect(mock.selection.select).toHaveBeenCalledTimes(expectedSelections);
                expect(contextMetrics(surface).moveEnds).toBe(moveEndsAfterAction);
                expect(mock.selection.select.mock.calls.length).toBe(selectionsAfterAction);
            } finally {
                vi.useRealTimers();
            }
        }
    );

    it("uses only the latest repeated wheel settle generation", () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true },
                    interaction: { mode: "reportSelection" }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            const before = contextMetrics(surface).moveEnds;
            for (let index = 0; index < 4; index++) {
                surface.dispatchEvent(pointer("wheel", {
                    deltaY: -30,
                    deltaMode: 0,
                    clientX: 160,
                    clientY: 150
                }));
            }
            vi.advanceTimersByTime(120);
            expect(contextMetrics(surface).moveEnds - before).toBe(1);
            expect(mock.selection.select).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(500);
            expect(contextMetrics(surface).moveEnds - before).toBe(1);
            expect(contextMetrics(surface).maxHostSelectionInFlight).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(["pointercancel", "lostpointercapture"] as const)(
        "cancels wheel started during pointer ownership on %s",
        (termination) => {
            vi.useFakeTimers();
            try {
                const { mock, visual } = mount();
                visual.update(updateOptions(buildMatrixDataView({
                    entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
                    bands: ["Band 1"],
                    profiles: ["Metric A"],
                    objects: {
                        context: { mode: "grid" },
                        navigation: { enabled: true },
                        interaction: { mode: "reportSelection" }
                    }
                })));
                const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
                setSurfaceBounds(surface, 320, 300);
                const before = contextMetrics(surface).moveEnds;
                surface.dispatchEvent(pointer("pointerdown", {
                    pointerId: 107,
                    button: 0,
                    clientX: 160,
                    clientY: 150
                }));
                surface.dispatchEvent(pointer("wheel", {
                    deltaY: -120,
                    deltaMode: 0,
                    clientX: 160,
                    clientY: 150
                }));
                surface.dispatchEvent(pointer(termination, {
                    pointerId: 107,
                    clientX: 160,
                    clientY: 150
                }));
                vi.advanceTimersByTime(500);
                expect(contextMetrics(surface).moveEnds).toBe(before);
                expect(mock.selection.select).not.toHaveBeenCalled();
            } finally {
                vi.useRealTimers();
            }
        }
    );

    it("rebinds targets when deferred completion lands during an ordinary press", async () => {
        const { mock, visual } = mount({ selectionBehavior: "deferred" });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true },
                interaction: { mode: "reportSelection" }
            }
        })));
        const originalTarget = mock.element.querySelector<HTMLElement>(".profile-lens-target")!;
        originalTarget.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 502,
            button: 0,
            clientX: 160,
            clientY: 150
        }));
        mock.selection.resolvePending();
        await Promise.resolve();
        await Promise.resolve();
        expect(mock.element.querySelector(".profile-lens-target")).toBe(originalTarget);
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 502,
            clientX: 160,
            clientY: 150
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        const rebuiltTarget = mock.element.querySelector<HTMLElement>(".profile-lens-target")!;
        expect(rebuiltTarget).not.toBe(originalTarget);
        rebuiltTarget.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
        expect(mock.selection.select).toHaveBeenCalledTimes(2);
    });

    it.each(["wheel", "drag", "pinch"] as const)(
        "external selection cancels pending %s settle without reverting camera",
        (action) => {
            vi.useFakeTimers();
            try {
                const { mock, visual } = mount();
                visual.update(updateOptions(buildMatrixDataView({
                    entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
                    bands: ["Band 1"],
                    profiles: ["Metric A"],
                    objects: {
                        context: { mode: "grid" },
                        navigation: { enabled: true },
                        interaction: { mode: "reportSelection" }
                    }
                })));
                const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
                setSurfaceBounds(surface, 320, 300);
                const beforeMoveEnds = contextMetrics(surface).moveEnds;

                if (action === "wheel") {
                    surface.dispatchEvent(pointer("wheel", {
                        deltaY: -120,
                        deltaMode: 0,
                        clientX: 160,
                        clientY: 150
                    }));
                } else if (action === "drag") {
                    surface.dispatchEvent(pointer("pointerdown", {
                        pointerId: 301,
                        button: 0,
                        clientX: 120,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointermove", {
                        pointerId: 301,
                        clientX: 160,
                        clientY: 150
                    }));
                } else {
                    surface.dispatchEvent(pointer("pointerdown", {
                        pointerId: 302,
                        pointerType: "touch",
                        button: 0,
                        clientX: 100,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointerdown", {
                        pointerId: 303,
                        pointerType: "touch",
                        button: 0,
                        clientX: 200,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointermove", {
                        pointerId: 303,
                        pointerType: "touch",
                        clientX: 240,
                        clientY: 150
                    }));
                }
                const movedTransform = mock.element.querySelector(
                    ".profile-lens-context-outline-layer"
                )?.getAttribute("transform");
                const external = mockSelectionId("|node:entity:2");
                mock.selection.emitExternal([external]);
                mock.selection.emitExternal([external]);

                if (action === "drag") {
                    surface.dispatchEvent(pointer("pointerup", {
                        pointerId: 301,
                        clientX: 160,
                        clientY: 150
                    }));
                } else if (action === "pinch") {
                    surface.dispatchEvent(pointer("pointerup", {
                        pointerId: 303,
                        pointerType: "touch",
                        clientX: 240,
                        clientY: 150
                    }));
                    surface.dispatchEvent(pointer("pointerup", {
                        pointerId: 302,
                        pointerType: "touch",
                        clientX: 100,
                        clientY: 150
                    }));
                }
                vi.advanceTimersByTime(500);

                expect(mock.element.querySelector(".profile-lens-context-outline-layer")
                    ?.getAttribute("transform")).toBe(movedTransform);
                expect(contextMetrics(surface).moveEnds).toBe(beforeMoveEnds);
                expect(mock.selection.select).not.toHaveBeenCalled();
                expect(mock.selection.selected[0]?.getKey()).toContain("entity:2");
                expect(contextMetrics(surface).hostSelectionExternalInvalidations).toBe(2);
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        }
    );

    it.each(["pointercancel", "lostpointercapture"] as const)(
        "rebinds targets after external selection ends a pressed gesture with %s",
        (termination) => {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true },
                    interaction: { mode: "reportSelection" }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            const originalTarget = mock.element.querySelector(".profile-lens-target");
            surface.dispatchEvent(pointer("pointerdown", {
                pointerId: 501,
                button: 0,
                clientX: 160,
                clientY: 150
            }));
            mock.selection.emitExternal([mockSelectionId("|node:entity:2")]);
            expect(mock.element.querySelector(".profile-lens-target")).toBe(originalTarget);
            surface.dispatchEvent(pointer(termination, {
                pointerId: 501,
                clientX: 160,
                clientY: 150
            }));
            const rebuiltTarget = mock.element.querySelector<HTMLElement>(".profile-lens-target");
            expect(rebuiltTarget).not.toBe(originalTarget);
            rebuiltTarget?.dispatchEvent(pointer("click", {
                clientX: 10,
                clientY: 10
            }));
            expect(mock.selection.select).toHaveBeenCalledTimes(1);
        }
    );

    it.each([
        ["profile", ".profile-lens-target"],
        ["entity", ".profile-lens-entity-option"]
    ] as const)(
        "does not swallow an in-progress %s click on external selection",
        (_kind, selector) => {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "none" },
                    interaction: { mode: "reportSelection" }
                }
            })));
            const pressed = mock.element.querySelector<HTMLElement>(selector)!;
            pressed.dispatchEvent(pointer("pointerdown", {
                pointerId: 503,
                button: 0,
                clientX: 10,
                clientY: 10
            }));
            mock.selection.emitExternal([mockSelectionId("|node:entity:1")]);
            expect(mock.element.querySelector(selector)).toBe(pressed);
            pressed.dispatchEvent(pointer("pointerup", {
                pointerId: 503,
                clientX: 10,
                clientY: 10
            }));
            pressed.dispatchEvent(pointer("click", {
                clientX: 10,
                clientY: 10
            }));
            expect(mock.selection.select).toHaveBeenCalledTimes(1);
        }
    );

    it.each([
        ["profile", ".profile-lens-target"],
        ["entity", ".profile-lens-entity-option"]
    ] as const)(
        "does not swallow an in-progress %s click on lifecycle update",
        async (_kind, selector) => {
            const { mock, visual } = mount();
            const view = buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "none" },
                    interaction: { mode: "reportSelection" }
                }
            });
            visual.update(updateOptions(view));
            const pressed = mock.element.querySelector<HTMLElement>(selector)!;
            pressed.dispatchEvent(pointer("pointerdown", {
                pointerId: 506,
                button: 0,
                clientX: 10,
                clientY: 10
            }));
            visual.update(updateOptions(view, { width: 900, height: 700 }));
            expect(mock.events.started).toHaveLength(2);
            expect(mock.events.finished).toHaveLength(1);
            expect(mock.events.failed).toHaveLength(0);
            expect(mock.element.querySelector(selector)).toBe(pressed);
            pressed.dispatchEvent(pointer("pointerup", {
                pointerId: 506,
                clientX: 10,
                clientY: 10
            }));
            pressed.dispatchEvent(pointer("click", {
                clientX: 10,
                clientY: 10
            }));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(mock.selection.select).toHaveBeenCalledTimes(1);
            expect(mock.events.failed).toHaveLength(0);
        }
    );

    it("reports a deferred render failure when the owned pointer terminates", async () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: { context: { mode: "grid" } }
        })));
        const pressed = mock.element.querySelector<HTMLElement>(".profile-lens-target")!;
        pressed.dispatchEvent(pointer("pointerdown", {
            pointerId: 507,
            button: 0,
            clientX: 10,
            clientY: 10
        }));
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["06037"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: {
                    mode: "builtInPack",
                    pack: "usCounties",
                    packKeyMode: "geoid5"
                }
            }
        })));
        expect(mock.events.started).toHaveLength(2);
        expect(mock.events.finished).toHaveLength(1);
        expect(mock.events.failed).toHaveLength(0);
        pressed.dispatchEvent(pointer("pointercancel", {
            pointerId: 507,
            clientX: 10,
            clientY: 10
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mock.events.finished).toHaveLength(1);
        expect(mock.events.failed).toHaveLength(1);
        expect(mock.events.failed[0]?.reason).toContain(
            "Context Canvas renderer could not create a 2D display context"
        );
    });

    it("supersedes an older navigation-deferred render with a newer update", () => {
        const { mock, visual } = mount();
        const view = buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true }
            }
        });
        visual.update(updateOptions(view, { width: 800, height: 600 }));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.dispatchEvent(pointer("wheel", {
            deltaY: -120,
            deltaMode: 0,
            clientX: 160,
            clientY: 150
        }));
        visual.update(updateOptions(view, { width: 900, height: 700 }));
        visual.update(updateOptions(view, { width: 1000, height: 800 }));
        surface.focus();
        surface.dispatchEvent(key("keydown", "Escape"));
        expect(mock.element.querySelector(".profile-lens-profile-svg")
            ?.getAttribute("width")).toBe("555");
        expect(mock.events.started).toHaveLength(3);
        expect(mock.events.finished).toHaveLength(3);
        expect(mock.events.failed).toHaveLength(0);
    });

    it("preserves deferred data through a later lifecycle-only update", async () => {
        const { mock, visual } = mount();
        const initialView = buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true }
            }
        });
        visual.update(updateOptions(initialView));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 510,
            button: 0,
            clientX: 120,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointermove", {
            pointerId: 510,
            clientX: 160,
            clientY: 150
        }));
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Replacement"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true }
            }
        })));
        (initialView.metadata as unknown as { objects?: powerbi.DataViewObjects }).objects = {
            context: { mode: "none" }
        } as unknown as powerbi.DataViewObjects;
        visual.update(updateOptions(initialView, { width: 1000, height: 800 }));
        expect(mock.events.started).toHaveLength(3);
        expect(mock.events.finished).toHaveLength(1);
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 510,
            clientX: 160,
            clientY: 150
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Replacement");
        expect(mock.element.querySelector(".profile-lens-context")?.hasAttribute("hidden"))
            .toBe(true);
        expect(mock.events.finished).toHaveLength(3);
        expect(mock.events.failed).toHaveLength(0);
    });

    it("preserves deferred append semantics when resize resends pending DataView", async () => {
        const { mock, visual } = mount();
        const initial = buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            segment: true,
            value: () => 1
        });
        const appended = buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            segment: true,
            value: () => 2
        });
        visual.update(updateOptions(initial, { width: 800, height: 600 }, {
            operationKind: 0 as powerbi.VisualDataChangeOperationKind
        }));
        const pressed = mock.element.querySelector<HTMLElement>(".profile-lens-target")!;
        pressed.dispatchEvent(pointer("pointerdown", {
            pointerId: 511,
            button: 0,
            clientX: 10,
            clientY: 10
        }));
        visual.update(updateOptions(appended, { width: 900, height: 700 }, {
            operationKind: 1 as powerbi.VisualDataChangeOperationKind
        }));
        visual.update(updateOptions(appended, { width: 1000, height: 800 }));
        pressed.dispatchEvent(pointer("pointercancel", {
            pointerId: 511,
            clientX: 10,
            clientY: 10
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mock.element.querySelector('[data-code="partialData"]')?.textContent)
            .toContain("2 segments");
        visual.update(updateOptions(appended, { width: 1100, height: 850 }));
        expect(mock.element.querySelector('[data-code="partialData"]')?.textContent)
            .toContain("2 segments");
        expect(mock.events.started).toHaveLength(4);
        expect(mock.events.finished).toHaveLength(4);
        expect(mock.events.failed).toHaveLength(0);
    });

    it("host update supersedes wheel before external selection", () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount();
            const objects = {
                context: { mode: "grid" },
                navigation: { enabled: true }
            } as unknown as powerbi.DataViewObjects;
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            surface.dispatchEvent(pointer("wheel", {
                deltaY: -120,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            }));
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Replacement"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects
            })));
            expect(mock.events.finished).toHaveLength(2);
            mock.selection.emitExternal([mockSelectionId("|node:entity:0")]);
            expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
                .toBe("Replacement");
            expect(mock.events.finished).toHaveLength(2);
            expect(contextMetrics(surface).moveEnds).toBe(0);
            expect(mock.selection.select).not.toHaveBeenCalled();
            vi.advanceTimersByTime(500);
            expect(mock.selection.select).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("host update supersedes wheel while local selection is pending", async () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount({ selectionBehavior: "deferred" });
            const view = buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true }
                }
            });
            visual.update(updateOptions(view));
            const beforeWidth = mock.element.querySelector(".profile-lens-profile-svg")
                ?.getAttribute("width");
            mock.element.querySelector<HTMLElement>(".profile-lens-target")
                ?.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            surface.dispatchEvent(pointer("wheel", {
                deltaY: -120,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            }));
            visual.update(updateOptions(view, { width: 900, height: 700 }));
            expect(mock.events.finished).toHaveLength(2);
            expect(mock.element.querySelector(".profile-lens-profile-svg")
                ?.getAttribute("width")).not.toBe(beforeWidth);
            mock.selection.resolvePending();
            await Promise.resolve();
            await Promise.resolve();
            vi.advanceTimersByTime(120);
            expect(mock.events.finished).toHaveLength(2);
            expect(mock.selection.select).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keyboard activates the replacement target after host update cancels wheel", async () => {
        const { mock, visual } = mount();
        const objects = {
            context: { mode: "grid" },
            navigation: { enabled: true }
        } as unknown as powerbi.DataViewObjects;
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B", "Entity C", "Entity D"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.dispatchEvent(pointer("wheel", {
            deltaY: -120,
            deltaMode: 0,
            clientX: 160,
            clientY: 150
        }));
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Replacement"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects
        })));
        const target = mock.element.querySelector<HTMLElement>(".profile-lens-target")!;
        target.focus();
        target.dispatchEvent(key("keydown", "Enter"));
        await Promise.resolve();
        await Promise.resolve();
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        const identity = mock.selection.select.mock.calls[0][0] as { getKey: () => string };
        expect(identity.getKey()).toContain("band:0:-1:0");
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe("Replacement");
    });

    it("keeps model coverage atomic while a data update is deferred by drag", async () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: [
                "Entity A", "Entity B", "Entity C",
                "Entity D", "Entity E", "Entity F",
                "Entity G", "Entity H", "Entity I"
            ],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: { context: { mode: "grid" } }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        const titleBefore = mock.element.querySelector(".profile-lens-header-title")?.textContent;
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 508,
            button: 0,
            clientX: 120,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointermove", {
            pointerId: 508,
            clientX: 160,
            clientY: 150
        }));
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: { context: { mode: "grid" } }
        })));
        expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
            .toBe(titleBefore);
        expect(mock.element.querySelector(".profile-lens-header-subtitle")?.textContent ?? "")
            .not.toContain("not loaded");
        expect(mock.events.started).toHaveLength(2);
        expect(mock.events.finished).toHaveLength(1);
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 508,
            clientX: 160,
            clientY: 150
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mock.events.failed).toHaveLength(0);
    });

    it("preserves Context click activation before a deferred empty update", async () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true },
                interaction: { mode: "reportSelection" }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 509,
            button: 0,
            clientX: 40,
            clientY: 250
        }));
        visual.update(updateOptions(buildMatrixDataView({
            entities: [],
            bands: [],
            profiles: []
        })));
        expect(surface.hasAttribute("hidden")).toBe(false);
        surface.dispatchEvent(pointer("pointerup", {
            pointerId: 509,
            clientX: 40,
            clientY: 250
        }));
        surface.dispatchEvent(pointer("click", {
            clientX: 40,
            clientY: 250
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mock.selection.select).toHaveBeenCalledTimes(1);
        expect(mock.events.failed).toHaveLength(0);
    });

    it("flushes deferred external selection after pointer release outside the visual", () => {
        const { mock, visual } = mount();
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A"],
            bands: ["Band 1"],
            profiles: ["Metric A"]
        })));
        const pressed = mock.element.querySelector<HTMLElement>(".profile-lens-target")!;
        pressed.dispatchEvent(pointer("pointerdown", {
            pointerId: 504,
            button: 0,
            clientX: 10,
            clientY: 10
        }));
        mock.selection.emitExternal([mockSelectionId("|node:band:0:-1:0")]);
        expect(mock.element.querySelector(".profile-lens-target")).toBe(pressed);
        document.dispatchEvent(pointer("pointerup", {
            pointerId: 504,
            clientX: 900,
            clientY: 700
        }));
        expect(mock.element.querySelector(".profile-lens-target")).not.toBe(pressed);
        expect(mock.element.querySelector(".profile-lens-target")
            ?.getAttribute("aria-pressed")).toBe("true");
    });

    it("flushes selection completion when a wheel settles", async () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount({ selectionBehavior: "deferred" });
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true }
                }
            })));
            const target = mock.element.querySelector<HTMLElement>(".profile-lens-target")!;
            target.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            surface.dispatchEvent(pointer("wheel", {
                deltaY: -120,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            }));
            mock.selection.resolvePending();
            await Promise.resolve();
            await Promise.resolve();
            expect(mock.element.querySelector(".profile-lens-target")).toBe(target);
            vi.advanceTimersByTime(120);
            expect(mock.element.querySelector(".profile-lens-target")).not.toBe(target);
            // Settle resolves probe focus onto a different entity, so highlight scoping
            // intentionally leaves the pre-settle band selection unpressed on the newly
            // rendered profile; assert the settle commit instead of a pressed state.
            expect(mock.selection.select).toHaveBeenCalledTimes(2);
            expect((mock.selection.select.mock.calls[1]?.[0] as { getKey: () => string })
                .getKey()).toContain("entity:");
        } finally {
            vi.useRealTimers();
        }
    });

    it("flushes deferred selection when keyboard input cancels wheel settle", async () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount({ selectionBehavior: "deferred" });
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true }
                }
            })));
            const target = mock.element.querySelector<HTMLElement>(".profile-lens-target")!;
            target.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            surface.dispatchEvent(pointer("wheel", {
                deltaY: -120,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            }));
            mock.selection.resolvePending();
            await Promise.resolve();
            await Promise.resolve();
            surface.focus();
            surface.dispatchEvent(key("keydown", "Escape"));
            expect(mock.element.querySelector(".profile-lens-target")).not.toBe(target);
            expect(mock.element.querySelector(".profile-lens-target")
                ?.getAttribute("aria-pressed")).toBe("true");
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not swallow profile press that cancels a wheel settle", async () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount({ selectionBehavior: "deferred" });
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1", "Band 2"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true }
                }
            })));
            const targets = mock.element.querySelectorAll<HTMLElement>(".profile-lens-target");
            targets[0]?.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            const moveEndsBefore = contextMetrics(surface).moveEnds;
            surface.dispatchEvent(pointer("wheel", {
                deltaY: -120,
                deltaMode: 0,
                clientX: 160,
                clientY: 150
            }));
            mock.selection.resolvePending();
            await Promise.resolve();
            await Promise.resolve();
            const pressed = targets[1]!;
            pressed.dispatchEvent(pointer("pointerdown", {
                pointerId: 505,
                button: 0,
                clientX: 20,
                clientY: 10
            }));
            expect(mock.element.querySelectorAll(".profile-lens-target")[1]).toBe(pressed);
            pressed.dispatchEvent(pointer("pointerup", {
                pointerId: 505,
                clientX: 20,
                clientY: 10
            }));
            pressed.dispatchEvent(pointer("click", {
                clientX: 20,
                clientY: 10
            }));
            expect(mock.selection.select).toHaveBeenCalledTimes(2);
            expect(mock.selection.pending).toHaveLength(1);
            vi.advanceTimersByTime(500);
            expect(contextMetrics(surface).moveEnds).toBe(moveEndsBefore);
            expect(mock.selection.select).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not capture or prevent navigation input when interactions are disabled", () => {
        const { mock, visual } = mount({ allowInteractions: false });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true }
            }
        })));
        const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
        setSurfaceBounds(surface, 320, 300);
        const transform = mock.element.querySelector(
            ".profile-lens-context-camera-layer"
        )?.getAttribute("transform");
        const wheel = pointer("wheel", {
            deltaY: -100,
            deltaMode: 0,
            clientX: 160,
            clientY: 150
        });
        surface.dispatchEvent(wheel);
        surface.dispatchEvent(pointer("pointerdown", {
            pointerId: 1,
            button: 0,
            clientX: 40,
            clientY: 150
        }));
        surface.dispatchEvent(pointer("pointermove", {
            pointerId: 1,
            clientX: 100,
            clientY: 150
        }));
        surface.dispatchEvent(key("keydown", "+"));
        expect(wheel.defaultPrevented).toBe(false);
        expect(mock.element.querySelector(".profile-lens-context-camera-layer")
            ?.getAttribute("transform")).toBe(transform);
        expect(contextMetrics(surface).cameraFrames).toBe(0);
        expect(surface.classList.contains("profile-lens-context-navigation-active")).toBe(false);
        expect(mock.element.querySelector(".profile-lens-context-reset")
            ?.hasAttribute("hidden")).toBe(true);
        expect(mock.selection.select).not.toHaveBeenCalled();
        expect(mock.tooltip.show).not.toHaveBeenCalled();
    });

    it.each(["pointercancel", "lostpointercapture"])(
        "cleans up %s without duplicate activation",
        (termination) => {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            surface.dispatchEvent(pointer("pointerdown", {
                pointerId: 91,
                button: 0,
                clientX: 40,
                clientY: 250
            }));
            surface.dispatchEvent(pointer("pointermove", {
                pointerId: 91,
                clientX: 80,
                clientY: 250
            }));
            surface.dispatchEvent(pointer(termination, {
                pointerId: 91,
                clientX: 80,
                clientY: 250
            }));
            surface.dispatchEvent(pointer("pointerup", {
                pointerId: 91,
                clientX: 80,
                clientY: 250
            }));
            surface.dispatchEvent(pointer("click", {
                clientX: 80,
                clientY: 250
            }));
            expect(surface.classList.contains("profile-lens-context-panning")).toBe(false);
            expect(mock.selection.select).not.toHaveBeenCalled();
            expect(mock.selection.showContextMenu).not.toHaveBeenCalled();
            mock.element.querySelector<HTMLElement>(".profile-lens-target")
                ?.dispatchEvent(pointer("click", { clientX: 10, clientY: 10 }));
            expect(mock.selection.select).toHaveBeenCalledTimes(1);
        }
    );
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

    it("discards a queued probe announcement after explicit keyboard browsing", () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: [
                    "Entity A", "Entity B", "Entity C",
                    "Entity D", "Entity E", "Entity F",
                    "Entity G", "Entity H", "Entity I"
                ],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    interaction: { mode: "localOnly" }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            surface.focus();
            const announcement = mock.element.querySelector<HTMLElement>(
                ".profile-lens-probe-announcement"
            )!;
            const initialAnnouncement = announcement.textContent;
            surface.dispatchEvent(key("keydown", "+"));
            surface.dispatchEvent(key("keydown", "+"));
            for (let index = 0; index < 5; index++) {
                surface.dispatchEvent(key("keydown", "ArrowLeft", { shiftKey: true }));
            }
            const queuedProbeTitle =
                mock.element.querySelector(".profile-lens-header-title")?.textContent;
            expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
            surface.dispatchEvent(key("keydown", "ArrowUp"));
            expect(mock.element.querySelector(".profile-lens-header-title")?.textContent)
                .not.toBe(queuedProbeTitle);
            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(250);
            expect(announcement.textContent).toBe(initialAnnouncement);
        } finally {
            vi.useRealTimers();
        }
    });

    it("uses the host high contrast colors and pattern differentiation", () => {
        const { mock, visual } = mount({ highContrast: true });
        visual.update(updateOptions(buildMatrixDataView({
            entities: ["Entity A", "Entity B"],
            bands: ["Band 1"],
            // Two series, because pattern differentiation only means anything when there is a
            // second series to differentiate.
            series: ["Series X", "Series Y"],
            profiles: ["Metric A"],
            objects: {
                context: { mode: "grid" },
                navigation: { enabled: true }
            }
        })));
        const root = mock.element.querySelector<HTMLElement>(".profile-lens");
        expect(root?.classList.contains("profile-lens-high-contrast")).toBe(true);
        expect(root?.style.getPropertyValue("--profile-lens-foreground")).toBe("#FFFFFF");
        expect(root?.style.getPropertyValue("--profile-lens-background")).toBe("#000000");
        expect(root?.style.getPropertyValue("--profile-lens-selected")).toBe("#00FF00");
        expect(root?.style.getPropertyValue("--profile-lens-muted")).toBe("#FFFFFF");
        expect(root?.style.getPropertyValue("--profile-lens-border")).toBe("#FFFFFF");
        const rect = mock.element.querySelector(".profile-lens-target rect.profile-lens-bar");
        expect(rect?.getAttribute("fill")).toBe("#FFFFFF");
        expect(rect?.getAttribute("stroke")).toBe("#FFFFFF");
        expect(mock.element.querySelector("pattern")).not.toBeNull();
    });

    it("switches direction for a right to left locale", () => {
        const { mock, visual } = mount({ locale: "he-IL" });
        visual.update(updateOptions(dataView()));
        expect(mock.element.querySelector(".profile-lens")?.getAttribute("dir")).toBe("rtl");
    });

    it("mirrors horizontal keyboard camera pan in right to left layouts", () => {
        const panForLocale = (locale: string): number => {
            const { mock, visual } = mount({ locale });
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            surface.dispatchEvent(key("keydown", "+"));
            surface.dispatchEvent(key("keydown", "ArrowLeft", { shiftKey: true }));
            const transform = mock.element.querySelector(".profile-lens-context-camera-layer")
                ?.getAttribute("transform") ?? "";
            const values = transform.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
            return values[4] ?? Number.NaN;
        };
        const ltr = panForLocale("en-US");
        resetDocument();
        const rtl = panForLocale("he-IL");
        expect(ltr).toBeGreaterThan(rtl);
    });

    it("keeps reduced-motion navigation immediate and free of animation timers", () => {
        vi.useFakeTimers();
        try {
            const { mock, visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: true },
                    accessibility: { reducedMotion: true }
                }
            })));
            const surface = mock.element.querySelector<HTMLElement>(".profile-lens-context")!;
            setSurfaceBounds(surface, 320, 300);
            surface.dispatchEvent(pointer("pointerdown", {
                pointerId: 1,
                button: 0,
                clientX: 40,
                clientY: 150
            }));
            surface.dispatchEvent(pointer("pointermove", {
                pointerId: 1,
                clientX: 60,
                clientY: 150
            }));
            surface.dispatchEvent(pointer("pointerup", {
                pointerId: 1,
                clientX: 60,
                clientY: 150
            }));
            expect(mock.element.querySelector(".profile-lens")
                ?.classList.contains("profile-lens-reduced-motion")).toBe(true);
            expect(contextMetrics(surface).cameraFrames).toBeGreaterThan(0);
            expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
            vi.advanceTimersByTime(250);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
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

    it("normalizes legacy navigation booleans in the formatting dropdown", () => {
        for (const [legacy, expected] of [[false, "off"], [true, "on"]] as const) {
            resetDocument();
            const { visual } = mount();
            visual.update(updateOptions(buildMatrixDataView({
                entities: ["Entity A", "Entity B"],
                bands: ["Band 1"],
                profiles: ["Metric A"],
                objects: {
                    context: { mode: "grid" },
                    navigation: { enabled: legacy }
                }
            })));
            expect(JSON.stringify(visual.getFormattingModel()))
                .toContain(`"value":"${expected}"`);
        }
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
