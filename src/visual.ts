"use strict";

import "../style/visual.less";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";

import { ProfileLensFormattingModel, ResolvedSettings, resolveSettings } from "./formatting";
import { Localization } from "./localization";
import {
    IMPLICIT_INDEX,
    ProfileDataModel,
    bandIdentityKey,
    isRenderable,
    tooltipKey
} from "./model/contract";
import { DEFAULT_PARSE_OPTIONS, parseMatrix } from "./model/parseMatrix";
import { fingerprintDataView } from "./model/fingerprint";
import {
    NormalizedFrame,
    formatDisplayValue,
    normalizeFrame,
    selectFrameCells
} from "./model/normalization";
import { compareDiagnostics, messageKeyFor, severityOf } from "./model/diagnostics";
import { SegmentTracker, withSegmentState } from "./model/segments";
import { computeProfileLayout } from "./layout/profileLayout";
import { createSvgTextMeasurer } from "./layout/textFit";
import { InteractionController, InteractionTarget, SurfaceInteraction } from "./interaction/controller";
import { renderAccessibleTable } from "./render/accessibleTable";
import {
    EntityOption,
    renderEntityList,
    renderHeader,
    renderLegend,
    renderPeriodControl
} from "./render/chrome";
import { renderLanding } from "./render/landing";
import { RenderedTarget, renderProfiles, targetKey } from "./render/profilesSvg";
import { renderStatus } from "./render/status";
import { resolveTheme } from "./render/theme";
import type {
    ContextFeature,
    ContextProviderInput,
    ContextScene,
    ContextSelectionIdentity
} from "./context/contract";
import { ContextProviderRegistry, ContextRendererRegistry } from "./context/registry";
import {
    BoundGeometryContextProvider,
    NoneContextProvider,
    OddRHexContextProvider,
    RectangularGridContextProvider,
    Wgs84PointContextProvider
} from "./context/providers";
import { fitScene } from "./context/projection";
import { chooseContextRenderer } from "./context/rendererSelection";
import { computeContextLayout } from "./layout/contextLayout";
import {
    ContextSurfaceElements,
    RenderedContextSurface,
    createContextSurface,
    hideContextSurface,
    renderContextSurface
} from "./render/contextSurface";
import { spatialNeighbor } from "./interaction/spatialNavigation";
import { DetailStrategyRegistry } from "./detail/registry";
import { createDefaultDetailStrategies } from "./detail/strategies";
import { createDefaultContextRenderers } from "./context/renderers";

import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.extensibility.ISelectionId;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

const SVG_NS = "http://www.w3.org/2000/svg";

export class Visual implements IVisual {
    private readonly host: IVisualHost;
    private readonly selectionManager: ISelectionManager;
    private readonly emptySelectionId: ISelectionId | null;
    private readonly formattingService: FormattingSettingsService;
    private readonly localization: Localization;
    private readonly controller: InteractionController;
    private readonly segments = new SegmentTracker();
    private readonly contextProviders = new ContextProviderRegistry();
    private readonly detailStrategies = new DetailStrategyRegistry();
    private readonly contextRenderers = new ContextRendererRegistry();

    private readonly root: HTMLElement;
    private readonly headerElement: HTMLElement;
    private readonly chartElement: HTMLElement;
    private readonly svg: SVGSVGElement;
    private readonly contextSurface: ContextSurfaceElements;
    private readonly legendElement: HTMLElement;
    private readonly entityElement: HTMLElement;
    private readonly periodElement: HTMLElement;
    private readonly statusElement: HTMLElement;
    private readonly tableElement: HTMLElement;
    private readonly landingElement: HTMLElement;

    private formattingModel = new ProfileLensFormattingModel();
    private settings: ResolvedSettings = resolveSettings(new ProfileLensFormattingModel());
    private model: ProfileDataModel | null = null;
    private lastDataView: powerbi.DataView | undefined;
    private lastFingerprint = "none";
    private focusedEntityKey: string | null = null;
    private selectedPeriodKey: string | null = null;
    private externalSelection: readonly ISelectionId[] = [];
    private measure: ((text: string, fontSize: number) => number) | undefined;
    private lastViewport = { width: 0, height: 0 };
    private renderedContext: RenderedContextSurface | null = null;
    private visualOwnedEntityFilterActive = false;
    private visualOwnedEntityFilterValue: unknown = undefined;
    private visualOwnedFilterBaseline: readonly powerbi.IFilter[] | null = null;
    private nextFilterGeneration = 1;
    private currentFilterGeneration = 0;
    private pendingFilterWrites: Array<{ readonly generation: number; readonly value: unknown }> = [];
    private visualFilterWriteValues: unknown[] = [];
    private missingCurrentFilterSnapshots = 0;
    private currentFilterAcknowledged = false;
    private lastHostJsonFilters: readonly powerbi.IFilter[] = [];

    public constructor(options?: VisualConstructorOptions) {
        if (!options) {
            throw new Error("Visual constructor options are required.");
        }
        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.emptySelectionId = this.host.createSelectionIdBuilder().createSelectionId();
        const localizationManager = this.host.createLocalizationManager();
        this.formattingService = new FormattingSettingsService(localizationManager);
        this.localization = new Localization(localizationManager, this.host.locale);

        this.root = document.createElement("div");
        this.root.className = "profile-lens";
        this.root.setAttribute("tabindex", "0");
        this.root.setAttribute("lang", this.host.locale ?? "en-US");
        this.root.setAttribute("aria-label", this.localization.get("Visual_Name"));
        options.element.appendChild(this.root);

        this.landingElement = appendChild(this.root, "div", "profile-lens-landing");
        this.headerElement = appendChild(this.root, "header", "profile-lens-header");
        const body = appendChild(this.root, "div", "profile-lens-body");
        this.entityElement = appendChild(body, "nav", "profile-lens-entities");
        this.chartElement = appendChild(body, "div", "profile-lens-chart");
        this.contextSurface = createContextSurface(this.chartElement);
        this.contextSurface.root.setAttribute("aria-label", this.localization.get("Context_Label"));
        this.svg = document.createElementNS(SVG_NS, "svg");
        this.svg.classList.add("profile-lens-profile-svg");
        this.chartElement.appendChild(this.svg);
        this.legendElement = appendChild(this.root, "div", "profile-lens-legend");
        this.periodElement = appendChild(this.root, "div", "profile-lens-period");
        this.statusElement = appendChild(this.root, "div", "profile-lens-status");
        this.tableElement = appendChild(this.root, "div", "profile-lens-table");

        this.controller = new InteractionController({
            root: this.root,
            selectionManager: this.selectionManager,
            tooltipService: this.host.tooltipService,
            emptySelectionId: this.emptySelectionId,
            onSelectionChanged: () => {
                this.externalSelection = this.selectionManager.getSelectionIds();
                this.rerenderFromCache();
            },
            onFocusChanged: (key) => this.handleFocusedTarget(key)
        });
        this.contextProviders.register(new NoneContextProvider());
        this.contextProviders.register(new Wgs84PointContextProvider());
        this.contextProviders.register(new BoundGeometryContextProvider());
        this.contextProviders.register(new RectangularGridContextProvider());
        this.contextProviders.register(new OddRHexContextProvider());
        for (const strategy of createDefaultDetailStrategies()) {
            this.detailStrategies.register(strategy);
        }
        for (const renderer of createDefaultContextRenderers()) {
            this.contextRenderers.register(renderer);
        }

        this.selectionManager.registerOnSelectCallback((ids: ISelectionId[]) => {
            this.externalSelection = ids;
            this.rerenderFromCache();
        });
    }

    public update(options: VisualUpdateOptions): void {
        this.host.eventService.renderingStarted(options);
        let finished = false;
        try {
            this.applyUpdate(options);
            finished = true;
            this.host.eventService.renderingFinished(options);
        } catch (error) {
            if (!finished) {
                this.renderFailure(error);
                this.host.eventService.renderingFailed(options, describeError(error));
            }
        }
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingService.buildFormattingModel(this.formattingModel);
    }

    public destroy(): void {
        this.controller.dispose();
    }

    private applyUpdate(options: VisualUpdateOptions): void {
        const dataView = options.dataViews?.[0];
        const metadataSource = dataView ?? this.lastDataView;
        const previousInteractionMode = this.settings.interactionMode;
        this.formattingModel = this.formattingService.populateFormattingSettingsModel(
            ProfileLensFormattingModel,
            metadataSource as powerbi.DataView
        );
        this.settings = resolveSettings(this.formattingModel);

        const allowInteractions = this.host.hostCapabilities?.allowInteractions !== false;
        this.controller.setAllowInteractions(allowInteractions);

        const fingerprint = fingerprintDataView(dataView);
        const isLifecycleOnly = dataView === undefined
            || (this.model !== null && fingerprint === this.lastFingerprint && dataView === this.lastDataView);

        if (!isLifecycleOnly) {
            this.segments.register(fingerprint, options.operationKind);
            const parsed = parseMatrix(
                dataView,
                {
                    ...DEFAULT_PARSE_OPTIONS,
                    maxProfiles: this.settings.maxProfiles,
                    maxSeries: this.settings.maxSeries,
                    formatValue: (value) => this.formatPrimitive(value)
                },
                {
                    createSelectionId: (node, levels) => this.host
                        .createSelectionIdBuilder()
                        .withMatrixNode(node, levels)
                        .createSelectionId()
                }
            );
            const moreDataAvailable = Boolean(dataView?.metadata?.segment);
            this.model = withSegmentState(parsed, this.segments.state(moreDataAvailable));
            this.lastDataView = dataView;
            this.lastFingerprint = fingerprint;

            const detailDecision = this.detailStrategies.resolve(this.settings.detailStrategy).evaluate({
                model: this.model,
                dataView,
                operationKind: options.operationKind
            });
            if (
                detailDecision.requestMore
                && moreDataAvailable
                && this.segments.canRequestMore()
            ) {
                this.host.fetchMoreData(true);
            }
        }

        const model = this.model;
        if (!model) {
            this.renderEmpty(options);
            return;
        }

        const hasFreshHostFilters = options.jsonFilters !== undefined;
        const enteredReportFilter = previousInteractionMode !== "reportFilter"
            && this.settings.interactionMode === "reportFilter";
        if (options.jsonFilters !== undefined) {
            this.lastHostJsonFilters = options.jsonFilters;
        }
        if (
            this.settings.interactionMode !== "reportFilter"
            || hasFreshHostFilters
            || enteredReportFilter
        ) {
            this.synchronizeFilterState(
                this.lastHostJsonFilters,
                model,
                allowInteractions,
                hasFreshHostFilters
            );
        }
        this.renderModel(model, options, allowInteractions);
    }

    private renderModel(
        model: ProfileDataModel,
        options: VisualUpdateOptions,
        allowInteractions: boolean
    ): void {
        const viewport = {
            width: Math.max(options.viewport?.width ?? 0, 0),
            height: Math.max(options.viewport?.height ?? 0, 0)
        };
        this.lastViewport = viewport;
        this.root.setAttribute("dir", this.resolveDirection());
        this.root.classList.toggle("profile-lens-reduced-motion", this.settings.reducedMotion);
        this.root.classList.toggle("profile-lens-high-contrast", Boolean(this.host.colorPalette?.isHighContrast));

        if (!isRenderable(model)) {
            this.landingElement.removeAttribute("hidden");
            renderLanding(this.landingElement, {
                stage: model.stage,
                model,
                localization: this.localization
            });
            this.chartElement.setAttribute("hidden", "hidden");
            this.headerElement.setAttribute("hidden", "hidden");
            this.entityElement.setAttribute("hidden", "hidden");
            this.periodElement.setAttribute("hidden", "hidden");
            this.legendElement.setAttribute("hidden", "hidden");
            this.tableElement.setAttribute("hidden", "hidden");
            renderStatus(this.statusElement, {
                model,
                localization: this.localization,
                showDiagnostics: this.settings.showDiagnostics,
                showCounts: this.settings.showCounts,
                summary: this.localization.get("Status_Empty"),
                busy: false
            });
            this.controller.bind([]);
            return;
        }

        this.landingElement.setAttribute("hidden", "hidden");
        this.chartElement.removeAttribute("hidden");
        this.tableElement.removeAttribute("hidden");

        const entityIndex = this.resolveEntityIndex(model);
        const periodIndex = this.resolvePeriodIndex(model, entityIndex);
        const frameCells = selectFrameCells(model.cells, { entityIndex, periodIndex });
        const frame = normalizeFrame(
            frameCells,
            model.profiles.map((profile) => profile.index),
            {
                mode: this.settings.normalization,
                percentScale: this.settings.percentScale,
                blankPolicy: this.settings.blankPolicy
            },
            model.hasAnyHighlight
        );

        const theme = resolveTheme(this.host.colorPalette, this.settings);
        const scene = this.buildContextScene(model);
        const hasContext = scene.features.length > 0 && scene.mode !== "none";
        const commonLayoutRequest = {
            profileCount: model.profiles.length,
            bandCount: model.bands.length,
            seriesCount: Math.max(model.series.length, 1),
            arrangement: this.settings.arrangement,
            armRotationDegrees: this.settings.armRotation,
            requestedBandGap: this.settings.bandGap,
            requestedThickness: this.settings.barThickness,
            showPeriodControl: this.settings.showPeriod && periodIndex !== IMPLICIT_INDEX,
            showLegend: this.settings.showLegend,
            showBandLabels: this.settings.showBandLabels,
            showValueLabels: this.settings.showValueLabels,
            showAxis: this.settings.showAxis,
            showHeader: this.settings.showHeader
        };
        const contextBounds = hasContext
            ? computeProfileLayout({
                viewport,
                ...commonLayoutRequest,
                showEntityList: false
            }).chart
            : { x: 0, y: 0, width: viewport.width, height: viewport.height };
        const localComposite = computeContextLayout(
            { width: contextBounds.width, height: contextBounds.height },
            this.settings.contextLayout,
            hasContext,
            this.resolveDirection() === "rtl"
        );
        const composite = {
            ...localComposite,
            context: localComposite.context
                ? {
                    ...localComposite.context,
                    x: localComposite.context.x + contextBounds.x,
                    y: localComposite.context.y + contextBounds.y
                }
                : null,
            profile: {
                ...localComposite.profile,
                x: localComposite.profile.x + contextBounds.x,
                y: localComposite.profile.y + contextBounds.y
            }
        };
        this.positionProfileSurface(composite.profile);
        const layout = computeProfileLayout({
            viewport: { width: composite.profile.width, height: composite.profile.height },
            ...commonLayoutRequest,
            showEntityList: !hasContext
                && this.settings.showEntityList
                && model.entities.length > 1
        });

        if (!this.measure) {
            this.measure = createSvgTextMeasurer(this.svg);
        }

        renderHeader(this.headerElement, {
            model,
            settings: this.settings,
            localization: this.localization,
            entityIndex,
            periodIndex
        });
        if (!layout.chrome.header) {
            this.headerElement.setAttribute("hidden", "hidden");
        }

        const selectedKeys = this.resolveSelectedTargetKeys(model, entityIndex, periodIndex);
        const selectedEntityKeys = this.resolveSelectedEntityKeys(scene);
        const hadFocus = this.root.contains(document.activeElement);
        const rendered = renderProfiles(this.svg, {
            model,
            frame,
            layout,
            settings: this.settings,
            theme,
            localization: this.localization,
            entityIndex,
            periodIndex,
            interactive: allowInteractions,
            focusKey: this.controller.currentFocusKey ?? rememberedFocusKey(model),
            selectedKeys,
            measure: this.measure
        });

        renderLegend(this.legendElement, {
            model,
            theme,
            localization: this.localization,
            visible: layout.chrome.legend
        });

        const entityOptions = renderEntityList(this.entityElement, {
            model,
            localization: this.localization,
            entityIndex,
            visible: layout.chrome.entityList,
            interactive: allowInteractions
        });
        this.bindEntityOptions(entityOptions, model, allowInteractions);

        const periodControl = renderPeriodControl(this.periodElement, {
            model,
            localization: this.localization,
            entityIndex,
            periodIndex,
            visible: layout.chrome.periodControl,
            interactive: allowInteractions
        });
        this.periodElement.style.order = this.settings.periodPosition === "top" ? "2" : "5";
        this.bindPeriodControl(periodControl.slider, model, entityIndex, periodIndex, allowInteractions);

        renderAccessibleTable(this.tableElement, {
            model,
            frame,
            localization: this.localization,
            entityIndex,
            periodIndex,
            visible: this.settings.tableVisibility === "visible"
        });

        const contextInteraction = composite.context
            ? this.renderContext(
                scene,
                composite.context,
                selectedEntityKeys,
                allowInteractions,
                composite.effectiveMode === "focusLens"
                    ? {
                        x: composite.profile.x + composite.profile.width / 2 - composite.context.x,
                        y: composite.profile.y + composite.profile.height / 2 - composite.context.y
                    }
                    : undefined
            )
            : null;
        if (!composite.context) {
            hideContextSurface(this.contextSurface);
            this.renderedContext = null;
        }
        this.controller.bind(
            this.buildTargets(rendered, model, frame, entityIndex, periodIndex),
            contextInteraction
        );
        this.controller.restoreFocus(hadFocus);

        const summary = model.segments.partial
            ? this.localization.get("Status_Partial")
            : this.localization.format(
                "Status_Ready",
                model.bands.length,
                model.profiles.length,
                model.entities[entityIndex]?.label ?? ""
            );
        const statusDiagnostics = [...model.diagnostics];
        statusDiagnostics.push(...scene.diagnostics);
        if (frame.zeroDenominatorCount > 0) {
            statusDiagnostics.push({
                code: "zeroDenominator",
                severity: severityOf("zeroDenominator"),
                messageKey: messageKeyFor("zeroDenominator"),
                rejected: frame.zeroDenominatorCount
            });
        }

        if (frame.negativeValueCount > 0) {
            statusDiagnostics.push({
                code: "negativeProfileValues",
                severity: severityOf("negativeProfileValues"),
                messageKey: messageKeyFor("negativeProfileValues"),
                rejected: frame.negativeValueCount
            });
        }
        if (!allowInteractions) {
            statusDiagnostics.push({
                code: "interactionsDisabled",
                severity: severityOf("interactionsDisabled"),
                messageKey: messageKeyFor("interactionsDisabled")
            });
        }
        const diagnosticsModel = {
            ...model,
            diagnostics: statusDiagnostics.sort(compareDiagnostics)
        };
        renderStatus(this.statusElement, {
            model: diagnosticsModel,
            localization: this.localization,
            showDiagnostics: this.settings.showDiagnostics,
            showCounts: this.settings.showCounts,
            summary,
            busy: model.segments.partial
        });
        if (!layout.chrome.status) {
            this.statusElement.classList.add("profile-lens-status-sr");
        } else {
            this.statusElement.classList.remove("profile-lens-status-sr");
        }
    }

    private buildContextScene(model: ProfileDataModel): ContextScene {
        const entityIdentities = new Map<number, ContextSelectionIdentity>(
            model.entities.map((entity) => [
                entity.index,
                { key: entity.key, hostIdentity: entity.identity }
            ])
        );
        const input: ContextProviderInput = {
            entities: model.entities,
            entityIdentities,
            contextValues: new Map(
                model.extension.contextValues.map((value) => [value.entityIndex, value.value])
            ),
            coordinates: model.extension.coordinates,
            geometryTexts: model.extension.geometry,
            authorLimits: {
                maxGeometryCharacters: this.settings.maxGeometryCharacters,
                maxSceneVertices: this.settings.maxSceneVertices
            }
        };
        const provider = this.contextProviders.resolve(this.settings.contextMode, input);
        if (provider) {
            return provider.provide(this.settings.contextMode, input);
        }
        return {
            providerId: "unavailable",
            mode: this.settings.contextMode,
            features: [],
            metrics: { featureCount: 0, ringCount: 0, vertexCount: 0 },
            partial: true,
            diagnostics: [{
                code: "contextProviderUnavailable",
                severity: "warning",
                messageKey: messageKeyFor("contextProviderUnavailable")
            }]
        };
    }

    private renderContext(
        scene: ContextScene,
        rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
        selectedKeys: ReadonlySet<string>,
        allowInteractions: boolean,
        connectorTarget?: { readonly x: number; readonly y: number }
    ): SurfaceInteraction {
        const root = this.contextSurface.root;
        root.style.inset = "auto";
        root.style.left = `${rect.x}px`;
        root.style.top = `${rect.y}px`;
        root.style.width = `${rect.width}px`;
        root.style.height = `${rect.height}px`;
        const viewport = { width: rect.width, height: rect.height };
        const kind = this.contextRenderers.resolve(chooseContextRenderer(scene, {
            maxSvgFeatures: this.settings.svgFeatureThreshold,
            maxSvgVertices: this.settings.svgVertexThreshold
        })).kind;
        const contextTheme = resolveTheme(this.host.colorPalette, this.settings);
        const transform = fitScene(scene, viewport);
        this.renderedContext = renderContextSurface(
            this.contextSurface,
            {
                scene,
                viewport,
                transform,
                focusedKey: this.focusedEntityKey,
                selectedKeys,
                interactive: allowInteractions,
                connectorTarget,
                pointSize: this.settings.contextPointSize
            },
            kind,
            {
                fill: contextTheme.isHighContrast
                    ? contextTheme.background
                    : this.settings.contextFillColor,
                stroke: contextTheme.isHighContrast
                    ? contextTheme.foreground
                    : this.settings.contextStrokeColor,
                selected: contextTheme.isHighContrast
                    ? contextTheme.foregroundSelected
                    : this.settings.contextSelectedColor,
                background: contextTheme.background,
                pointSize: this.settings.contextPointSize
            },
            window.devicePixelRatio || 1
        );
        return {
            element: root,
            resolve: (x, y) => {
                const hit = this.renderedContext?.hitTest(x, y);
                const feature = hit
                    ? scene.features.find((entry) => entry.index === hit.featureIndex)
                    : null;
                return feature ? this.contextTarget(feature) : null;
            },
            navigate: (currentKey, direction) => {
                const feature = spatialNeighbor(
                    scene.features,
                    currentKey,
                    direction,
                    transform,
                    this.resolveDirection() === "rtl"
                );
                return feature ? this.contextTarget(feature) : null;
            },
            targetForKey: (key) => {
                const entityKey = key?.startsWith("context:")
                    ? key.slice("context:".length)
                    : this.focusedEntityKey;
                const feature = scene.features.find((entry) => entry.key === entityKey)
                    ?? scene.features[0];
                return feature ? this.contextTarget(feature) : null;
            },
            hasKey: (key) => key.startsWith("context:")
                && scene.features.some((feature) => `context:${feature.key}` === key)
        };
    }

    private contextTarget(feature: ContextFeature): InteractionTarget {
        const identity = this.settings.interactionMode === "reportSelection"
            ? feature.selection.hostIdentity as ISelectionId | null
            : null;
        return {
            key: `context:${feature.key}`,
            element: this.contextSurface.root,
            identity,
            activate: () => this.handleActivatedTarget(feature.key),
            tooltip: () => [
                { displayName: this.localization.get("Tooltip_Entity"), value: feature.label },
                ...feature.tooltipValues
            ]
        };
    }

    private resolveSelectedEntityKeys(scene: ContextScene): ReadonlySet<string> {
        const keys = new Set<string>();
        for (const feature of scene.features) {
            const identity = feature.selection.hostIdentity as ISelectionId | null;
            if (identity && this.externalSelection.some((selection) => {
                const comparable = selection as unknown as powerbi.visuals.ISelectionId;
                return typeof comparable.equals === "function"
                    ? comparable.equals(identity as unknown as powerbi.visuals.ISelectionId)
                    : selection === identity;
            })) {
                keys.add(feature.key);
            }
        }
        return keys;
    }

    private positionProfileSurface(
        rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
    ): void {
        this.svg.style.position = "absolute";
        this.svg.style.left = `${rect.x}px`;
        this.svg.style.top = `${rect.y}px`;
        this.svg.style.width = `${rect.width}px`;
        this.svg.style.height = `${rect.height}px`;
    }

    private handleFocusedTarget(key: string | null): void {
        if (!key?.startsWith("context:") || !this.model) {
            return;
        }
        const entityKey = key.slice("context:".length);
        const entity = this.model.entities.find((entry) => entry.key === entityKey);
        if (!entity) {
            return;
        }
        this.focusedEntityKey = entity.key;
        this.selectedPeriodKey = null;
        this.rerenderFromCache();
    }

    private handleActivatedTarget(entityKey: string): void {
        if (!this.model || this.settings.interactionMode !== "reportFilter") {
            return;
        }
        const entity = this.model.entities.find((entry) => entry.key === entityKey);
        if (entity) {
            this.applyEntityFilter(entity);
        }
    }

    private activateEntityHost(entity: ProfileDataModel["entities"][number]): void {
        if (this.settings.interactionMode === "reportFilter") {
            this.applyEntityFilter(entity);
            return;
        }
        if (this.settings.interactionMode === "reportSelection" && entity.identity) {
            void this.selectionManager
                .select(entity.identity as ISelectionId, false)
                .then(() => {
                    this.externalSelection = this.selectionManager.getSelectionIds();
                    this.rerenderFromCache();
                });
        }
    }

    private applyEntityFilter(entity: ProfileDataModel["entities"][number]): void {
        const target = this.entityFilterTarget();
        if (!target || entity.value === null || entity.value instanceof Date) {
            return;
        }
        if (!this.visualOwnedEntityFilterActive) {
            this.visualOwnedFilterBaseline = this.lastHostJsonFilters;
        }
        const filter = {
            target,
            operator: "In",
            values: [entity.value],
            filterType: 1
        } as unknown as powerbi.IFilter;
        this.host.applyJsonFilter(filter, "general", "filter", 0);
        this.visualOwnedEntityFilterActive = true;
        this.visualOwnedEntityFilterValue = entity.value;
        this.currentFilterGeneration = this.nextFilterGeneration++;
        this.pendingFilterWrites.push({
            generation: this.currentFilterGeneration,
            value: entity.value
        });
        this.visualFilterWriteValues.push(entity.value);
        this.missingCurrentFilterSnapshots = 0;
        this.currentFilterAcknowledged = false;
    }

    private synchronizeFilterState(
        filters: readonly powerbi.IFilter[],
        model: ProfileDataModel,
        allowInteractions: boolean,
        hasFreshHostFilters: boolean
    ): void {
        if (this.settings.interactionMode !== "reportFilter") {
            if (this.visualOwnedEntityFilterActive && allowInteractions) {
                this.host.applyJsonFilter(
                    null as unknown as powerbi.IFilter,
                    "general",
                    "filter",
                    1
                );
                this.lastHostJsonFilters = hasFreshHostFilters
                    ? this.externalSnapshotAfterVisualRemoval(filters)
                    : this.visualOwnedFilterBaseline ?? this.lastHostJsonFilters;
                this.clearVisualFilterOwnership();
            }
            return;
        }
        const target = this.entityFilterTarget();
        const matching = filters
            .map((candidate, index) => ({ candidate, index }))
            .filter(({ candidate }) => {
            const actual = candidate as unknown as {
                target?: { table?: string; column?: string };
            };
            return target
                && actual.target?.table === target.table
                && actual.target?.column === target.column;
        });
        let filter: powerbi.IFilter | undefined = matching[0]?.candidate;
        if (this.visualOwnedEntityFilterActive && this.currentFilterGeneration > 0) {
            const oldestWrite = this.pendingFilterWrites[0];
            if (oldestWrite) {
                const echo = matching.find(({ candidate }) =>
                    this.singleFilterValue(candidate) === oldestWrite.value);
                this.pendingFilterWrites.shift();
                this.visualOwnedFilterBaseline = this.externalSnapshotAfterVisualRemoval(filters);
                if (
                    echo
                    && oldestWrite.generation === this.currentFilterGeneration
                    && this.pendingFilterWrites.length === 0
                ) {
                    filter = echo.candidate;
                    this.missingCurrentFilterSnapshots = 0;
                    this.currentFilterAcknowledged = true;
                } else if (this.pendingFilterWrites.length > 0) {
                    this.focusOwnedEntity(model);
                    return;
                } else {
                    this.clearVisualFilterOwnership();
                    filter = matching[0]?.candidate;
                }
            } else {
                const owned = matching.find(({ candidate }) =>
                    this.singleFilterValue(candidate) === this.visualOwnedEntityFilterValue);
                if (owned) {
                    filter = owned.candidate;
                    this.visualOwnedFilterBaseline = this.externalSnapshotAfterVisualRemoval(filters);
                    this.missingCurrentFilterSnapshots = 0;
                    this.currentFilterAcknowledged = true;
                } else {
                    this.missingCurrentFilterSnapshots++;
                    this.visualOwnedFilterBaseline = this.externalSnapshotAfterVisualRemoval(filters);
                    if (!this.currentFilterAcknowledged && this.missingCurrentFilterSnapshots < 2) {
                        this.focusOwnedEntity(model);
                        return;
                    }
                    this.clearVisualFilterOwnership();
                    filter = matching[0]?.candidate;
                }
            }
        }
        const values = (filter as unknown as { values?: readonly unknown[] } | undefined)?.values;
        if (!values || values.length !== 1) {
            this.focusedEntityKey = model.entities[0]?.key ?? null;
            this.controller.setFocusKey(
                this.focusedEntityKey ? `context:${this.focusedEntityKey}` : null
            );
            this.clearVisualFilterOwnership();
            return;
        }
        const match = model.entities.find((entity) => entity.value === values[0]);
        if (match) {
            this.focusedEntityKey = match.key;
            this.controller.setFocusKey(`context:${match.key}`);
        } else {
            this.focusedEntityKey = model.entities[0]?.key ?? null;
            this.controller.setFocusKey(
                this.focusedEntityKey ? `context:${this.focusedEntityKey}` : null
            );
        }
    }

    private focusOwnedEntity(model: ProfileDataModel): void {
        const match = model.entities.find(
            (entity) => entity.value === this.visualOwnedEntityFilterValue
        );
        this.focusedEntityKey = match?.key ?? model.entities[0]?.key ?? null;
        this.controller.setFocusKey(
            this.focusedEntityKey ? `context:${this.focusedEntityKey}` : null
        );
    }

    private clearVisualFilterOwnership(): void {
        this.visualOwnedEntityFilterActive = false;
        this.visualOwnedEntityFilterValue = undefined;
        this.visualOwnedFilterBaseline = null;
        this.currentFilterGeneration = 0;
        this.pendingFilterWrites = [];
        this.visualFilterWriteValues = [];
        this.missingCurrentFilterSnapshots = 0;
        this.currentFilterAcknowledged = false;
    }

    private singleFilterValue(filter: powerbi.IFilter): unknown {
        const values = (filter as unknown as { values?: readonly unknown[] }).values;
        return values?.length === 1 ? values[0] : undefined;
    }

    private externalSnapshotAfterVisualRemoval(
        filters: readonly powerbi.IFilter[]
    ): readonly powerbi.IFilter[] {
        const target = this.entityFilterTarget();
        const baseline = [...(this.visualOwnedFilterBaseline ?? [])];
        const additions = filters.filter((filter) => {
            const candidate = filter as unknown as {
                target?: { table?: string; column?: string };
            };
            const isVisualTarget = target
                && candidate.target?.table === target.table
                && candidate.target?.column === target.column;
            return !isVisualTarget
                || !this.visualFilterWriteValues.includes(this.singleFilterValue(filter));
        });
        const seen = new Set(baseline.map((filter) => JSON.stringify(filter)));
        for (const filter of additions) {
            const key = JSON.stringify(filter);
            if (!seen.has(key)) {
                seen.add(key);
                baseline.push(filter);
            }
        }
        return baseline;
    }

    private entityFilterTarget(): { readonly table: string; readonly column: string } | null {
        const queryName = this.lastDataView?.matrix?.rows?.levels?.[0]?.sources?.[0]?.queryName;
        const separator = queryName?.lastIndexOf(".") ?? -1;
        return queryName && separator > 0
            ? {
                table: queryName.slice(0, separator),
                column: queryName.slice(separator + 1)
            }
            : null;
    }

    private buildTargets(
        rendered: readonly RenderedTarget[],
        model: ProfileDataModel,
        frame: NormalizedFrame,
        entityIndex: number,
        periodIndex: number
    ): readonly InteractionTarget[] {
        return rendered.map((target) => ({
            key: target.key,
            element: target.element,
            identity: (model.bandIdentities.get(
                bandIdentityKey(entityIndex, periodIndex, target.bandIndex)
            ) as ISelectionId | undefined) ?? null,
            tooltip: () => this.buildTooltipItems(model, frame, target, entityIndex, periodIndex)
        }));
    }

    private buildTooltipItems(
        model: ProfileDataModel,
        frame: NormalizedFrame,
        target: RenderedTarget,
        entityIndex: number,
        periodIndex: number
    ): readonly VisualTooltipDataItem[] {
        const items: VisualTooltipDataItem[] = [];
        const entity = model.entities[entityIndex];
        const periods = model.periodsByEntity.get(entityIndex) ?? [];
        const band = model.bands[target.bandIndex];
        const profile = model.profiles[target.profileIndex];
        const cell = frame.profiles
            .find((entry) => entry.profileIndex === target.profileIndex)
            ?.cells.find(
                (entry) => entry.bandIndex === target.bandIndex && entry.seriesIndex === target.seriesIndex
            );

        items.push({ displayName: this.localization.get("Tooltip_Entity"), value: entity?.label ?? "" });
        if (periodIndex !== IMPLICIT_INDEX && periods[periodIndex]) {
            items.push({
                displayName: this.localization.get("Tooltip_Period"),
                value: periods[periodIndex].label
            });
        }
        items.push({ displayName: this.localization.get("Tooltip_Band"), value: band?.label ?? "" });
        if (target.seriesIndex !== IMPLICIT_INDEX) {
            items.push({
                displayName: this.localization.get("Tooltip_Series"),
                value: model.series[target.seriesIndex]?.label ?? ""
            });
        }
        items.push({
            displayName: this.localization.get("Tooltip_Profile"),
            value: profile?.label ?? ""
        });
        items.push({
            displayName: this.localization.get("Tooltip_Raw"),
            value: cell?.raw === null || cell === undefined
                ? this.localization.get("Table_Missing")
                : this.localization.formatNumber(cell.raw)
        });
        if (this.settings.normalization !== "raw") {
            items.push({
                displayName: this.localization.get("Tooltip_Displayed"),
                value: formatDisplayValue(
                    cell?.display ?? null,
                    frame.mode,
                    this.localization.currentLocale
                )
            });
        }
        const bound = model.tooltipIndex.get(
            tooltipKey(entityIndex, periodIndex, target.bandIndex, target.seriesIndex)
        );
        for (const datum of bound ?? []) {
            items.push({ displayName: datum.label, value: datum.value });
        }
        return items;
    }

    private bindEntityOptions(
        options: readonly EntityOption[],
        model: ProfileDataModel,
        allowInteractions: boolean
    ): void {
        if (!allowInteractions) {
            this.entityElement.setAttribute("aria-disabled", "true");
            this.entityElement.onfocus = () => this.root.focus();
            for (const option of options) {
                option.element.addEventListener("focus", () => this.root.focus());
            }
            return;
        }
        this.entityElement.removeAttribute("aria-disabled");
        this.entityElement.onfocus = null;
        const focusEntity = (index: number): void => {
            this.focusedEntityKey = model.entities[index]?.key ?? null;
            this.selectedPeriodKey = null;
            this.rerenderFromCache();
            this.entityElement
                .querySelector<HTMLElement>(`[data-entity-index="${index}"]`)
                ?.focus();
        };
        for (const option of options) {
            option.element.addEventListener("click", () => {
                focusEntity(option.index);
                const entity = model.entities[option.index];
                if (entity) {
                    this.activateEntityHost(entity);
                }
            });
            option.element.addEventListener("keydown", (event: KeyboardEvent) => {
                let next = option.index;
                switch (event.key) {
                    case "ArrowRight":
                    case "ArrowDown":
                        next = Math.min(option.index + 1, options.length - 1);
                        break;
                    case "ArrowLeft":
                    case "ArrowUp":
                        next = Math.max(option.index - 1, 0);
                        break;
                    case "Home":
                        next = 0;
                        break;
                    case "End":
                        next = options.length - 1;
                        break;
                    case "Enter":
                    case " ":
                        event.preventDefault();
                        {
                            const entity = model.entities[option.index];
                            if (entity) {
                                this.activateEntityHost(entity);
                            }
                        }
                        return;
                    default:
                        return;
                }
                event.preventDefault();
                focusEntity(next);
            });
        }
    }

    private bindPeriodControl(
        slider: HTMLElement | null,
        model: ProfileDataModel,
        entityIndex: number,
        periodIndex: number,
        allowInteractions: boolean
    ): void {
        if (!slider) {
            return;
        }
        if (!allowInteractions) {
            slider.addEventListener("focus", () => this.root.focus());
            return;
        }
        const periods = model.periodsByEntity.get(entityIndex) ?? [];
        slider.addEventListener("keydown", (event: KeyboardEvent) => {
            let next = periodIndex;
            switch (event.key) {
                case "ArrowRight":
                case "ArrowUp":
                    next = Math.min(periodIndex + 1, periods.length - 1);
                    break;
                case "ArrowLeft":
                case "ArrowDown":
                    next = Math.max(periodIndex - 1, 0);
                    break;
                case "Home":
                    next = 0;
                    break;
                case "End":
                    next = periods.length - 1;
                    break;
                default:
                    return;
            }
            event.preventDefault();
            if (next === periodIndex) {
                return;
            }
            this.selectedPeriodKey = periods[next]?.key ?? null;
            this.rerenderFromCache();
            const focus = this.periodElement.querySelector<HTMLElement>(".profile-lens-period-slider");
            focus?.focus();
        });
    }

    private resolveEntityIndex(model: ProfileDataModel): number {
        if (this.focusedEntityKey !== null) {
            const match = model.entities.findIndex((entity) => entity.key === this.focusedEntityKey);
            if (match >= 0) {
                return match;
            }
        }
        this.focusedEntityKey = model.entities[0]?.key ?? null;
        return 0;
    }

    private resolvePeriodIndex(model: ProfileDataModel, entityIndex: number): number {
        const periods = model.periodsByEntity.get(entityIndex) ?? [];
        if (periods.length === 0) {
            return IMPLICIT_INDEX;
        }
        if (this.selectedPeriodKey !== null) {
            const match = periods.findIndex((period) => period.key === this.selectedPeriodKey);
            if (match >= 0) {
                return match;
            }
        }
        this.selectedPeriodKey = periods[0].key;
        return 0;
    }

    private resolveSelectedTargetKeys(
        model: ProfileDataModel,
        entityIndex: number,
        periodIndex: number
    ): ReadonlySet<string> {
        const keys = new Set<string>();
        if (this.externalSelection.length === 0) {
            return keys;
        }
        for (const band of model.bands) {
            const identity = model.bandIdentities.get(
                bandIdentityKey(entityIndex, periodIndex, band.index)
            ) as ISelectionId | undefined;
            if (!identity) {
                continue;
            }
            const selected = this.externalSelection.some((candidate) => {
                const comparable = candidate as unknown as powerbi.visuals.ISelectionId;
                return typeof comparable.equals === "function"
                    ? comparable.equals(identity as unknown as powerbi.visuals.ISelectionId)
                    : candidate === identity;
            });
            if (!selected) {
                continue;
            }
            for (const profile of model.profiles) {
                const seriesIndexes = model.series.length === 0
                    ? [IMPLICIT_INDEX]
                    : model.series.map((series) => series.index);
                for (const seriesIndex of seriesIndexes) {
                    keys.add(targetKey(profile.index, band.index, seriesIndex));
                }
            }
        }
        return keys;
    }

    private rerenderFromCache(): void {
        const model = this.model;
        if (!model) {
            return;
        }
        const allowInteractions = this.host.hostCapabilities?.allowInteractions !== false;
        this.renderModel(
            model,
            {
                viewport: this.lastViewport
            } as VisualUpdateOptions,
            allowInteractions
        );
    }

    private renderEmpty(options: VisualUpdateOptions): void {
        this.chartElement.setAttribute("hidden", "hidden");
        this.landingElement.removeAttribute("hidden");
        renderLanding(this.landingElement, {
            stage: "empty",
            model: emptyModelShim(),
            localization: this.localization
        });
        this.statusElement.textContent = this.localization.get("Status_Empty");
        void options;
    }

    private renderFailure(error: unknown): void {
        this.chartElement.setAttribute("hidden", "hidden");
        this.landingElement.removeAttribute("hidden");
        clear(this.landingElement);
        const message = document.createElement("p");
        message.className = "profile-lens-error";
        message.textContent = `${this.localization.get("Status_Failed")} ${describeError(error)}`;
        this.landingElement.appendChild(message);
    }

    private resolveDirection(): "ltr" | "rtl" {
        if (this.settings.direction === "ltr" || this.settings.direction === "rtl") {
            return this.settings.direction;
        }
        return this.localization.isRightToLeft ? "rtl" : "ltr";
    }

    private formatPrimitive(value: powerbi.PrimitiveValue): string {
        if (value === null || value === undefined) {
            return "";
        }
        if (typeof value === "number") {
            return this.localization.formatNumber(value);
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        return String(value);
    }
}

function rememberedFocusKey(model: ProfileDataModel): string | null {
    const profile = model.profiles[0];
    const band = model.bands[0];
    if (!profile || !band) {
        return null;
    }
    const seriesIndex = model.series[0]?.index ?? IMPLICIT_INDEX;
    return targetKey(profile.index, band.index, seriesIndex);
}

function emptyModelShim(): ProfileDataModel {
    return parseMatrix(undefined);
}

function appendChild(parent: HTMLElement, tag: string, className: string): HTMLElement {
    const element = document.createElement(tag);
    element.className = className;
    parent.appendChild(element);
    return element;
}

function clear(node: Element): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
