import type powerbi from "powerbi-visuals-api";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Mock, vi } from "vitest";

type ISelectionId = powerbi.extensibility.ISelectionId;
type HostMock = Mock<(...args: unknown[]) => unknown>;

/** The real English resource file, so tests exercise the shipped strings rather than raw keys. */
const RESOURCES = JSON.parse(
    readFileSync(
        resolve(__dirname, "..", "..", "stringResources", "en-US", "resources.resjson"),
        "utf8"
    )
) as Record<string, string>;

export interface MockSelectionId {
    readonly key: string;
    equals(other: MockSelectionId): boolean;
    includes(other: MockSelectionId): boolean;
    getKey(): string;
    getSelector(): unknown;
    getSelectorsByColumn(): unknown;
    hasIdentity(): boolean;
}

export interface MockHostOptions {
    readonly allowInteractions?: boolean;
    readonly highContrast?: boolean;
    readonly locale?: string;
    readonly tooltipsEnabled?: boolean;
    readonly moreDataAvailable?: boolean;
}

export interface MockHost {
    readonly host: powerbi.extensibility.visual.IVisualHost;
    readonly element: HTMLElement;
    readonly events: {
        started: powerbi.extensibility.visual.VisualUpdateOptions[];
        finished: powerbi.extensibility.visual.VisualUpdateOptions[];
        failed: Array<{ options: powerbi.extensibility.visual.VisualUpdateOptions; reason?: string }>;
    };
    readonly tooltip: {
        show: HostMock;
        move: HostMock;
        hide: HostMock;
    };
    readonly selection: {
        select: HostMock;
        showContextMenu: HostMock;
        selected: MockSelectionId[];
        onSelectCallback: ((ids: ISelectionId[]) => void) | null;
    };
    readonly fetchMoreData: HostMock;
    readonly applyJsonFilter: HostMock;
}

function createSelectionId(key: string): MockSelectionId {
    return {
        key,
        equals: (other) => other?.key === key,
        includes: (other) => other?.key === key,
        getKey: () => key,
        getSelector: () => ({ key }),
        getSelectorsByColumn: () => ({}),
        hasIdentity: () => true
    };
}

/** Builds an identity that compares equal to the one the visual creates for the same matrix node. */
export function mockSelectionId(key: string): ISelectionId {
    return createSelectionId(key) as unknown as ISelectionId;
}

export function createMockHost(options: MockHostOptions = {}): MockHost {
    const element = document.createElement("div");
    element.style.width = "800px";
    element.style.height = "600px";
    document.body.appendChild(element);

    const events: MockHost["events"] = { started: [], finished: [], failed: [] };
    const tooltip = {
        show: vi.fn() as HostMock,
        move: vi.fn() as HostMock,
        hide: vi.fn() as HostMock
    };
    const selection: MockHost["selection"] = {
        select: vi.fn() as HostMock,
        showContextMenu: vi.fn() as HostMock,
        selected: [],
        onSelectCallback: null
    };
    const fetchMoreData = vi.fn(() => true) as unknown as HostMock;
    const applyJsonFilter = vi.fn() as HostMock;

    let identityCounter = 0;

    const selectionManager = {
        select: (id: ISelectionId | ISelectionId[], multiSelect?: boolean) => {
            selection.select(id, multiSelect);
            const ids = Array.isArray(id) ? id : [id];
            selection.selected = ids as unknown as MockSelectionId[];
            return Promise.resolve(ids);
        },
        showContextMenu: (id: ISelectionId, position: powerbi.extensibility.IPoint) => {
            selection.showContextMenu(id, position);
            return Promise.resolve({});
        },
        hasSelection: () => selection.selected.length > 0,
        clear: () => {
            selection.selected = [];
            return Promise.resolve({});
        },
        getSelectionIds: () => selection.selected as unknown as ISelectionId[],
        registerOnSelectCallback: (callback: (ids: ISelectionId[]) => void) => {
            selection.onSelectCallback = callback;
        },
        toggleExpandCollapse: () => Promise.resolve({}),
        applySelectionFilter: () => undefined,
        registerOnSelectCallbackDeprecated: () => undefined
    };

    const colorPalette = {
        isHighContrast: Boolean(options.highContrast),
        foreground: { value: "#FFFFFF" },
        foregroundLight: { value: "#FFFFFF" },
        foregroundDark: { value: "#000000" },
        foregroundNeutralLight: { value: "#FFFFFF" },
        foregroundNeutralDark: { value: "#000000" },
        foregroundNeutralSecondary: { value: "#FFFFFF" },
        foregroundNeutralSecondaryAlt: { value: "#FFFFFF" },
        foregroundSelected: { value: "#00FF00" },
        foregroundButton: { value: "#FFFFFF" },
        background: { value: "#000000" },
        backgroundLight: { value: "#000000" },
        backgroundNeutral: { value: "#000000" },
        backgroundDark: { value: "#000000" },
        hyperlink: { value: "#00B7C3" },
        visitedHyperlink: { value: "#00B7C3" },
        selection: { value: "#00FF00" },
        separator: { value: "#FFFFFF" },
        shapeStroke: { value: "#FFFFFF" },
        getColor: (key: string) => ({ value: `#1${key.length}8DFF` }),
        reset: () => colorPalette
    };

    const host = {
        createSelectionIdBuilder: () => {
            let key = "";
            const builder = {
                withCategory: () => builder,
                withSeries: () => builder,
                withMeasure: (measure: string) => {
                    key += `|measure:${measure}`;
                    return builder;
                },
                withMatrixNode: (matrixNode: powerbi.DataViewMatrixNode) => {
                    const identity = (matrixNode.identity as unknown as { key?: string })?.key;
                    key += `|node:${identity ?? String(matrixNode.value ?? identityCounter++)}`;
                    return builder;
                },
                withTable: () => builder,
                createSelectionId: () => createSelectionId(key || `id:${identityCounter++}`) as unknown as ISelectionId
            };
            return builder as unknown as powerbi.visuals.ISelectionIdBuilder;
        },
        createSelectionManager: () => selectionManager as unknown as powerbi.extensibility.ISelectionManager,
        createLocalizationManager: () => ({
            getDisplayName: (key: string) => RESOURCES[key] ?? key
        }) as powerbi.extensibility.ILocalizationManager,
        colorPalette,
        persistProperties: () => undefined,
        eventService: {
            renderingStarted: (updateOptions: powerbi.extensibility.visual.VisualUpdateOptions) => {
                events.started.push(updateOptions);
            },
            renderingFinished: (updateOptions: powerbi.extensibility.visual.VisualUpdateOptions) => {
                events.finished.push(updateOptions);
            },
            renderingFailed: (
                updateOptions: powerbi.extensibility.visual.VisualUpdateOptions,
                reason?: string
            ) => {
                events.failed.push({ options: updateOptions, reason });
            }
        },
        tooltipService: {
            enabled: () => options.tooltipsEnabled !== false,
            show: tooltip.show,
            move: tooltip.move,
            hide: tooltip.hide
        },
        hostCapabilities: { allowInteractions: options.allowInteractions !== false },
        locale: options.locale ?? "en-US",
        fetchMoreData,
        instanceId: "mock-instance",
        refreshHostData: () => undefined,
        applyJsonFilter,
        storageService: undefined,
        launchUrl: () => undefined,
        openModalDialog: () => Promise.resolve({}),
        displayWarningIcon: () => undefined,
        telemetry: { trace: () => undefined },
        licenseManager: undefined,
        webAccessService: undefined,
        downloadService: undefined,
        switchFocusModeState: () => undefined,
        createOpaqueUtils: () => ({})
    };

    return {
        host: host as unknown as powerbi.extensibility.visual.IVisualHost,
        element,
        events,
        tooltip,
        selection,
        fetchMoreData,
        applyJsonFilter
    };
}

export function updateOptions(
    dataView: powerbi.DataView | undefined,
    viewport: { width: number; height: number } = { width: 800, height: 600 },
    extra: Partial<powerbi.extensibility.visual.VisualUpdateOptions> = {}
): powerbi.extensibility.visual.VisualUpdateOptions {
    return {
        viewport,
        dataViews: dataView ? [dataView] : [],
        type: 2,
        viewMode: 1,
        editMode: 0,
        isInFocus: false,
        operationKind: 0,
        jsonFilters: [],
        ...extra
    } as unknown as powerbi.extensibility.visual.VisualUpdateOptions;
}
