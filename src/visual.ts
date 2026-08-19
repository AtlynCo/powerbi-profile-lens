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
import {
    InteractionController,
    InteractionFocusSource,
    InteractionTarget,
    SurfaceInteraction
} from "./interaction/controller";
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
    ContextEntityBinding,
    ContextFeature,
    ContextProviderInput,
    ContextRenderRequest,
    ContextScene,
    ContextSelectionIdentity
} from "./context/contract";
import { ContextProviderRegistry, ContextRendererRegistry } from "./context/registry";
import {
    BoundGeometryContextProvider,
    NoneContextProvider,
    OddRHexContextProvider,
    RectangularGridContextProvider,
    StaticContextPackProvider,
    Wgs84PointContextProvider
} from "./context/providers";
import { fitScene } from "./context/projection";
import { chooseContextRenderer } from "./context/rendererSelection";
import { computeContextLayout } from "./layout/contextLayout";
import {
    ContextPerformanceMetrics,
    ContextSurfaceElements,
    RenderedContextSurface,
    createContextPerformanceMetrics,
    createContextSurface,
    hideContextSurface,
    recordContextSceneBuild,
    recordCanvasTargetMapLookup,
    renderContextSurface
} from "./render/contextSurface";
import { spatialNeighbor } from "./interaction/spatialNavigation";
import { DetailStrategyRegistry } from "./detail/registry";
import { createDefaultDetailStrategies } from "./detail/strategies";
import { createDefaultContextRenderers } from "./context/renderers";
import {
    RUNTIME_LICENSE_NOTICES,
    RUNTIME_LICENSE_NOTICES_SHA256
} from "./runtimeLicenses";
import {
    clampCameraToBounds,
    projectBounds,
    sceneBounds,
    viewportOverscroll
} from "./context/viewport/bounds";
import {
    cameraFromPinchSnapshot,
    composeSceneTransform,
    createPinchSnapshot,
    panCamera,
    preserveCameraOnResize,
    resetCamera,
    zoomCameraAt
} from "./context/viewport/camera";
import { contextSceneIdentity } from "./context/viewport/identity";
import type {
    CameraLimits,
    ContextCamera,
    ContextPinchSnapshot,
    ContextViewportSession
} from "./context/viewport/contract";
import { centerProbe } from "./context/viewport/probe";
import {
    ContextFocusState,
    FallbackResolution,
    ProfileDetailCoverage,
    buildProfileDetailCoverage,
    resolveEntityFocus,
    resolveFallbackEntity,
    resolveFeatureFocus
} from "./context/viewport/focus";

import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ISelectionId = powerbi.extensibility.ISelectionId;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;

const SVG_NS = "http://www.w3.org/2000/svg";

interface CachedContextScene {
    readonly key: string;
    readonly identity: string;
    readonly scene: ContextScene;
}

interface FocusedRenderSession {
    readonly model: ProfileDataModel;
    readonly scene: ContextScene;
    readonly sceneIdentity: string;
    readonly allowInteractions: boolean;
    readonly profileRect: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
    };
    readonly hasContext: boolean;
    readonly contextInteraction: SurfaceInteraction | null;
    readonly connectorTarget?: { readonly x: number; readonly y: number };
}

interface LocalSelectionOperation {
    readonly sequence: number;
    readonly generation: number;
    readonly kind: "entity" | "profile";
    readonly source: "explicit" | "settle" | "profile";
    readonly key: string;
    readonly identity: ISelectionId;
    readonly multiSelect: boolean;
    readonly entityKey?: string;
}

interface DeferredHostUpdate {
    readonly options: VisualUpdateOptions;
    readonly dataViewIdentity: powerbi.DataView | null;
}

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
    private readonly probeAnnouncementElement: HTMLElement;

    private formattingModel = new ProfileLensFormattingModel();
    private settings: ResolvedSettings = resolveSettings(new ProfileLensFormattingModel());
    private model: ProfileDataModel | null = null;
    private lastDataView: powerbi.DataView | undefined;
    private lastDataViewIdentity: powerbi.DataView | undefined;
    private lastFingerprint = "none";
    private focusedEntityKey: string | null = null;
    private selectedPeriodKey: string | null = null;
    private externalSelection: readonly ISelectionId[] = [];
    private measure: ((text: string, fontSize: number) => number) | undefined;
    private renderedContext: RenderedContextSurface | null = null;
    private readonly contextMetrics: ContextPerformanceMetrics = createContextPerformanceMetrics();
    private contextSceneCache: CachedContextScene | null = null;
    private viewportSession: ContextViewportSession | null = null;
    private modelRevision = 0;
    private detailCoverage: ProfileDetailCoverage | null = null;
    private fallbackResolution: FallbackResolution = { kind: "disabled" };
    private activeContextFocus: ContextFocusState | null = null;
    private focusedRenderSession: FocusedRenderSession | null = null;
    private contextRenderRequest: ContextRenderRequest | null = null;
    private lastProbeGeometryKey: string | null = null;
    private selectionSequence = 0;
    private selectionGeneration = 0;
    private selectionInFlight: LocalSelectionOperation | null = null;
    private readonly selectionQueue: LocalSelectionOperation[] = [];
    private lastCommittedEntityKey: string | null = null;
    private runtimeSelectionRejected = false;
    private runtimeSelectionRejectionNeedsAnnouncement = false;
    private contextDescriptionCache: {
        readonly key: string;
        readonly descriptions: ReadonlyMap<string, string>;
    } | null = null;
    private probeAnnouncementTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingProbeAnnouncement: {
        readonly message: string;
        readonly token: string;
    } | null = null;
    private lastProbeAnnouncementToken: string | null = null;
    private pendingProfileTargets: readonly InteractionTarget[] = [];
    private destroyed = false;
    private readonly activePointerPresses = new Set<number>();
    private selectionRenderPending = false;
    private selectionRenderTimer: ReturnType<typeof setTimeout> | null = null;
    private postReleaseClickGrace = false;
    private deferredHostUpdate: DeferredHostUpdate | null = null;
    private readonly deferredHostOptions: VisualUpdateOptions[] = [];
    private readonly rootPointerDownHandler = (event: PointerEvent): void => {
        if (Number.isInteger(event.pointerId)) {
            this.activePointerPresses.add(event.pointerId);
        }
    };
    private readonly rootPointerEndHandler = (event: PointerEvent): void => {
        if (!this.activePointerPresses.delete(event.pointerId)) {
            return;
        }
        if (this.activePointerPresses.size > 0) {
            return;
        }
        if (event.type === "pointerup") {
            this.postReleaseClickGrace = true;
            this.scheduleSelectionRenderFallback();
        } else {
            this.postReleaseClickGrace = false;
            this.flushSelectionStateRender();
        }
    };
    private readonly rootClickHandler = (): void => {
        this.postReleaseClickGrace = false;
        if (this.hasDeferredRender()) {
            this.flushSelectionStateRender();
            return;
        }
        this.flushSelectionStateRender();
    };
    private readonly documentPointerEndHandler = (event: PointerEvent): void => {
        if (
            this.root.contains(event.target as Node)
            || !this.activePointerPresses.has(event.pointerId)
        ) {
            return;
        }
        this.activePointerPresses.delete(event.pointerId);
        if (this.activePointerPresses.size === 0) {
            this.postReleaseClickGrace = false;
            this.flushSelectionStateRender();
        }
    };

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
        this.root.addEventListener("pointerdown", this.rootPointerDownHandler, true);
        this.root.addEventListener("pointerup", this.rootPointerEndHandler, true);
        this.root.addEventListener("pointercancel", this.rootPointerEndHandler, true);
        this.root.addEventListener("lostpointercapture", this.rootPointerEndHandler, true);
        this.root.addEventListener("click", this.rootClickHandler);
        document.addEventListener("pointerup", this.documentPointerEndHandler, true);
        document.addEventListener("pointercancel", this.documentPointerEndHandler, true);
        const runtimeLicenses = appendChild(
            this.root,
            "div",
            "profile-lens-runtime-license-notices"
        );
        runtimeLicenses.setAttribute("hidden", "hidden");
        runtimeLicenses.setAttribute("data-notice-sha256", RUNTIME_LICENSE_NOTICES_SHA256);
        runtimeLicenses.textContent = RUNTIME_LICENSE_NOTICES;

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
        this.probeAnnouncementElement = appendChild(
            this.root,
            "div",
            "profile-lens-probe-announcement"
        );
        this.probeAnnouncementElement.setAttribute("role", "status");
        this.probeAnnouncementElement.setAttribute("aria-live", "polite");
        this.probeAnnouncementElement.setAttribute("aria-atomic", "true");

        this.controller = new InteractionController({
            root: this.root,
            selectionManager: this.selectionManager,
            tooltipService: this.host.tooltipService,
            emptySelectionId: this.emptySelectionId,
            onFocusChanged: (key, source) => this.handleFocusedTarget(key, source)
        });
        this.contextProviders.register(new NoneContextProvider());
        this.contextProviders.register(new Wgs84PointContextProvider());
        this.contextProviders.register(new BoundGeometryContextProvider());
        this.contextProviders.register(new RectangularGridContextProvider());
        this.contextProviders.register(new OddRHexContextProvider());
        this.contextProviders.register(new StaticContextPackProvider());
        for (const strategy of createDefaultDetailStrategies()) {
            this.detailStrategies.register(strategy);
        }
        for (const renderer of createDefaultContextRenderers()) {
            this.contextRenderers.register(renderer);
        }

        this.selectionManager.registerOnSelectCallback((ids: ISelectionId[]) => {
            this.handleExternalSelection(ids);
        });
    }

    public update(options: VisualUpdateOptions): void {
        this.host.eventService.renderingStarted(options);
        const allowInteractions = this.host.hostCapabilities?.allowInteractions !== false;
        if (!allowInteractions) {
            this.controller.setAllowInteractions(false);
            this.invalidateQueuedSelections();
            this.clearProbeAnnouncement();
            this.activePointerPresses.clear();
            this.postReleaseClickGrace = false;
            this.clearSelectionRenderTimer();
        }
        this.controller.cancelPendingNavigationSettle();
        if (this.shouldDeferHostUpdate()) {
            this.deferredHostUpdate = this.coalesceHostUpdate(
                this.deferredHostUpdate,
                options
            );
            this.deferredHostOptions.push(options);
            if (this.postReleaseClickGrace) {
                this.scheduleSelectionRenderFallback();
            }
            return;
        }
        const effectiveUpdate = this.coalesceHostUpdate(
            this.deferredHostUpdate,
            options
        );
        const lifecycleOptions = [
            ...this.deferredHostOptions.splice(0),
            options
        ];
        this.deferredHostUpdate = null;
        this.selectionRenderPending = false;
        this.clearSelectionRenderTimer();
        this.executeHostUpdate(
            effectiveUpdate.options,
            lifecycleOptions,
            effectiveUpdate.dataViewIdentity
        );
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingService.buildFormattingModel(this.formattingModel);
    }

    public destroy(): void {
        this.destroyed = true;
        this.invalidateQueuedSelections();
        this.root.removeEventListener("pointerdown", this.rootPointerDownHandler, true);
        this.root.removeEventListener("pointerup", this.rootPointerEndHandler, true);
        this.root.removeEventListener("pointercancel", this.rootPointerEndHandler, true);
        this.root.removeEventListener("lostpointercapture", this.rootPointerEndHandler, true);
        this.root.removeEventListener("click", this.rootClickHandler);
        document.removeEventListener("pointerup", this.documentPointerEndHandler, true);
        document.removeEventListener("pointercancel", this.documentPointerEndHandler, true);
        this.clearSelectionRenderTimer();
        this.activePointerPresses.clear();
        this.postReleaseClickGrace = false;
        this.failDeferredHostRenders(new Error("Visual destroyed before deferred rendering."));
        this.deferredHostUpdate = null;
        this.selectionRenderPending = false;
        this.controller.dispose();
        this.clearProbeAnnouncement();
    }

    private applyUpdate(options: VisualUpdateOptions): void {
        const dataView = options.dataViews?.[0];
        const metadataSource = dataView ?? this.lastDataView;
        this.formattingModel = this.formattingService.populateFormattingSettingsModel(
            ProfileLensFormattingModel,
            metadataSource as powerbi.DataView
        );
        this.settings = resolveSettings(this.formattingModel, metadataSource?.metadata?.objects);
        this.formattingModel.navigation.enabled.value = this.settings.navigationMode;

        const allowInteractions = this.host.hostCapabilities?.allowInteractions !== false;
        this.controller.setAllowInteractions(allowInteractions);
        if (!allowInteractions) {
            this.invalidateQueuedSelections();
            this.clearProbeAnnouncement();
        }

        const fingerprint = fingerprintDataView(dataView);
        const isLifecycleOnly = dataView === undefined
            || (
                this.model !== null
                && fingerprint === this.lastFingerprint
                && dataView === this.lastDataViewIdentity
            );

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
            this.modelRevision++;
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

        this.detailCoverage = buildProfileDetailCoverage(model);
        this.fallbackResolution = resolveFallbackEntity(
            model,
            this.detailCoverage,
            this.settings.fallbackEntityKey
        );
        this.renderModel(model, {
            viewport: options.viewport
        } as VisualUpdateOptions, allowInteractions);
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
        if (
            this.viewportSession
            && (
                !Number.isFinite(viewport.width)
                || !Number.isFinite(viewport.height)
                || viewport.width <= 0
                || viewport.height <= 0
            )
        ) {
            this.viewportSession = { ...this.viewportSession, invalidResize: true };
        }
        this.root.setAttribute("dir", this.resolveDirection());
        this.root.classList.toggle("profile-lens-reduced-motion", this.settings.reducedMotion);
        this.root.classList.toggle("profile-lens-high-contrast", Boolean(this.host.colorPalette?.isHighContrast));

        if (!isRenderable(model) && !this.canRenderBindingFreeContext()) {
            this.clearFocusedRenderSession();
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
        this.applyThemeVariables(theme);
        const contextScene = this.resolveContextScene(model);
        const scene = contextScene.scene;
        if (
            !this.activeContextFocus
            || this.focusedRenderSession?.model !== model
            || this.focusedRenderSession?.sceneIdentity !== contextScene.identity
        ) {
            this.reconcileActiveFocus(model, scene, entityIndex);
        }
        const hasContext = scene.backdrop.features.length > 0 && scene.mode !== "none";
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
        const selectedFeatureKeys = this.resolveSelectedFeatureKeys(scene);
        const hadProfileFocus = this.svg.contains(document.activeElement);
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

        const connectorTarget = composite.context && composite.effectiveMode === "focusLens"
            ? {
                x: composite.profile.x + composite.profile.width / 2 - composite.context.x,
                y: composite.profile.y + composite.profile.height / 2 - composite.context.y
            }
            : undefined;
        const contextInteraction = composite.context
            ? this.renderContext(
                scene,
                contextScene.identity,
                composite.context,
                selectedFeatureKeys,
                allowInteractions,
                connectorTarget
            )
            : null;
        if (!composite.context) {
            hideContextSurface(this.contextSurface);
            this.renderedContext = null;
            this.contextRenderRequest = null;
        }
        this.pendingProfileTargets = this.buildTargets(
            rendered,
            model,
            frame,
            entityIndex,
            periodIndex
        );
        this.controller.bind(this.pendingProfileTargets, contextInteraction);
        this.controller.restoreFocus(hadProfileFocus);

        const baseSummary = model.segments.partial
            ? this.localization.get("Status_Partial")
            : this.localization.format(
                "Status_Ready",
                model.bands.length,
                model.profiles.length,
                model.entities[entityIndex]?.label ?? ""
            );
        const rejectionAnnouncement = this.runtimeSelectionRejectionNeedsAnnouncement
            ? ` ${this.localization.get("Context_SelectionRejected")}`
            : "";
        const summary = (
            hasContext
                ? `${baseSummary} ${this.contextCoverageSummary(scene)}`
                : baseSummary
        ) + rejectionAnnouncement;
        const statusDiagnostics = [...model.diagnostics];
        statusDiagnostics.push(...scene.diagnostics);
        if (this.fallbackResolution.kind === "invalid") {
            statusDiagnostics.push({
                code: "fallbackEntityInvalid",
                severity: severityOf("fallbackEntityInvalid"),
                messageKey: messageKeyFor("fallbackEntityInvalid")
            });
        }
        if (this.runtimeSelectionRejected) {
            statusDiagnostics.push({
                code: "hostSelectionRejected",
                severity: severityOf("hostSelectionRejected"),
                messageKey: messageKeyFor("hostSelectionRejected")
            });
        }
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
        const probeActivelyNavigable = this.activeContextFocus?.source === "probe"
            && this.contextRenderRequest?.navigation.enabled === true
            && allowInteractions;
        renderStatus(this.statusElement, {
            model: diagnosticsModel,
            localization: this.localization,
            showDiagnostics: this.settings.showDiagnostics,
            showCounts: this.settings.showCounts,
            summary,
            busy: model.segments.partial,
            announce: !probeActivelyNavigable
        });
        this.runtimeSelectionRejectionNeedsAnnouncement = false;
        if (!layout.chrome.status) {
            this.statusElement.classList.add("profile-lens-status-sr");
        } else {
            this.statusElement.classList.remove("profile-lens-status-sr");
        }
        this.focusedRenderSession = {
            model,
            scene,
            sceneIdentity: contextScene.identity,
            allowInteractions,
            profileRect: composite.profile,
            hasContext,
            contextInteraction,
            connectorTarget
        };
        const requiresFocusedPresentation = !this.fullRenderRepresentsFocus(
            this.activeContextFocus,
            entityIndex,
            periodIndex
        );
        if (
            this.contextRenderRequest?.navigation.enabled
            && allowInteractions
            && contextInteraction
        ) {
            this.resolveProbeFocus(requiresFocusedPresentation);
        } else if (requiresFocusedPresentation && this.activeContextFocus) {
            this.requestSelectionStateRender();
        }
    }

    private resolveContextScene(model: ProfileDataModel): CachedContextScene {
        const key = JSON.stringify({
            modelRevision: this.modelRevision,
            mode: this.settings.contextMode,
            pack: this.settings.contextPack,
            worldDetail: this.settings.worldDetail,
            packKeyMode: this.settings.packKeyMode,
            maxGeometryCharacters: this.settings.maxGeometryCharacters,
            maxSceneVertices: this.settings.maxSceneVertices
        });
        if (this.contextSceneCache?.key === key) {
            return this.contextSceneCache;
        }
        const started = performance.now();
        const scene = this.buildContextScene(model);
        const identity = contextSceneIdentity(scene);
        recordContextSceneBuild(this.contextMetrics, performance.now() - started);
        const cached = {
            key,
            identity,
            scene
        };
        this.contextSceneCache = cached;
        return cached;
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
            },
            pack: this.settings.contextMode === "builtInPack"
                ? {
                    id: resolvePackId(this.settings.contextPack, this.settings.worldDetail),
                    keyMode: resolvePackKeyMode(
                        this.settings.contextPack,
                        this.settings.packKeyMode
                    )
                }
                : undefined
        };
        const provider = this.contextProviders.resolve(this.settings.contextMode, input);
        if (provider) {
            return provider.provide(this.settings.contextMode, input);
        }
        return {
            providerId: "unavailable",
            mode: this.settings.contextMode,
            backdrop: {
                features: [],
                featureByKey: new Map(),
                metrics: { featureCount: 0, ringCount: 0, vertexCount: 0 }
            },
            entities: {
                byFeatureKey: new Map(),
                featureKeyByEntityKey: new Map()
            },
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
        sceneIdentity: string,
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
        const navigationEnabled = this.navigationEnabledFor(scene);
        const kind = this.contextRenderers.resolve(chooseContextRenderer(scene, {
            maxSvgFeatures: this.settings.svgFeatureThreshold,
            maxSvgVertices: this.settings.svgVertexThreshold
        })).kind;
        const contextTheme = resolveTheme(this.host.colorPalette, this.settings);
        const rawBounds = sceneBounds(scene);
        if (!rawBounds) {
            throw new Error("A visible context scene must contain finite geometry.");
        }
        const baseTransform = fitScene(scene, viewport);
        const baseBounds = projectBounds(rawBounds, baseTransform);
        const session = this.resolveViewportSession(
            sceneIdentity,
            baseTransform,
            baseBounds,
            viewport
        );
        const focusedFeatureKey = this.activeContextFocus?.featureKey
            ?? (
                this.focusedEntityKey === null
                    ? null
                    : scene.entities.featureKeyByEntityKey.get(this.focusedEntityKey) ?? null
            );
        const request: ContextRenderRequest = {
            scene,
            sceneIdentity,
            paintIdentity: contextPaintIdentity(scene, this.settings.showNoDataBackdrop),
            viewport,
            baseTransform,
            camera: session.camera,
            focusedFeatureKey,
            selectedFeatureKeys: selectedKeys,
            featureDescriptions: this.contextFeatureDescriptions(scene, sceneIdentity),
            showNoDataBackdrop: this.settings.showNoDataBackdrop,
            interactive: allowInteractions,
            navigation: {
                enabled: navigationEnabled,
                showProbe: this.settings.showCenterProbe,
                showResetControl: this.settings.showResetControl,
                showGestureHelp: this.settings.showGestureHelp,
                resetLabel: this.localization.get("Navigation_Reset"),
                probeDescription: this.localization.get("Navigation_ProbeDescription"),
                gestureHelp: this.localization.get("Navigation_GestureHelp")
            },
            connectorTarget,
            pointSize: this.settings.contextPointSize
        };
        this.contextRenderRequest = request;
        this.renderedContext = renderContextSurface(
            this.contextSurface,
            request,
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
            window.devicePixelRatio || 1,
            this.contextMetrics
        );
        const targetsByIndex = new Map(
            scene.backdrop.features.map((feature) => [
                feature.index,
                this.contextTarget(feature, scene.entities.byFeatureKey.get(feature.key) ?? null)
            ])
        );
        return {
            element: root,
            resolve: (x, y) => {
                const hit = this.renderedContext?.hitTest(x, y);
                if (!hit) {
                    return null;
                }
                const target = targetsByIndex.get(hit.featureIndex) ?? null;
                recordCanvasTargetMapLookup(root, target !== null);
                return target;
            },
            navigate: (currentKey, direction) => {
                const feature = spatialNeighbor(
                    scene.backdrop.features,
                    currentKey,
                    direction,
                    composeSceneTransform(baseTransform, this.viewportSession?.camera ?? session.camera),
                    this.resolveDirection() === "rtl"
                );
                return feature
                    ? this.contextTarget(
                        feature,
                        scene.entities.byFeatureKey.get(feature.key) ?? null
                    )
                    : null;
            },
            targetForKey: (key) => {
                const entityKey = key?.startsWith("context:")
                    ? key.slice("context:".length)
                    : this.activeContextFocus?.featureKey;
                const feature = entityKey
                    ? scene.backdrop.featureByKey.get(entityKey)
                    : undefined;
                const resolved = feature ?? scene.backdrop.features[0];
                return resolved
                    ? this.contextTarget(
                        resolved,
                        scene.entities.byFeatureKey.get(resolved.key) ?? null
                    )
                    : null;
            },
            hasKey: (key) => key.startsWith("context:")
                && scene.backdrop.featureByKey.has(key.slice("context:".length)),
            navigation: navigationEnabled
                ? {
                    resetElement: this.contextSurface.resetButton,
                    wheelSensitivity: this.settings.wheelSensitivity,
                    rtl: this.resolveDirection() === "rtl",
                    panBy: (deltaX, deltaY) => this.panContextCamera(deltaX, deltaY),
                    zoomAt: (factor, x, y) => this.zoomContextCamera(factor, x, y),
                    beginPinch: (x, y) => this.beginContextPinch(x, y),
                    pinchTo: (snapshot, ratio, x, y) =>
                        this.pinchContextCamera(snapshot, ratio, x, y),
                    reset: () => this.resetContextCamera(),
                    moveEnd: (cancelled = false, clickExpected = false) => {
                        if (cancelled) {
                            this.bindFocusedInteractions();
                            if (!clickExpected) {
                                this.postReleaseClickGrace = false;
                                this.clearSelectionRenderTimer();
                                this.flushSelectionStateRender();
                            }
                            return;
                        }
                        this.postReleaseClickGrace = false;
                        this.clearSelectionRenderTimer();
                        this.contextMetrics.moveEnds++;
                        this.handleContextMoveEnd();
                        this.flushSelectionStateRender();
                    }
                }
                : undefined
        };
    }

    private resolveViewportSession(
        sceneIdentity: string,
        baseTransform: ReturnType<typeof fitScene>,
        baseBounds: ReturnType<typeof projectBounds>,
        viewport: { readonly width: number; readonly height: number }
    ): ContextViewportSession {
        const limits = this.cameraLimits(viewport);
        const existing = this.viewportSession;
        let camera: ContextCamera;
        if (
            !existing
            || existing.sceneIdentity !== sceneIdentity
            || existing.invalidResize
        ) {
            camera = resetCamera(limits, baseBounds, viewport);
        } else if (
            existing.viewport.width !== viewport.width
            || existing.viewport.height !== viewport.height
            || existing.baseTransform.scale !== baseTransform.scale
            || existing.baseTransform.translateX !== baseTransform.translateX
            || existing.baseTransform.translateY !== baseTransform.translateY
            || existing.baseTransform.invertY !== baseTransform.invertY
        ) {
            camera = preserveCameraOnResize(
                existing.camera,
                existing.baseTransform,
                baseTransform,
                existing.viewport,
                viewport,
                baseBounds,
                limits
            ) ?? resetCamera(limits, baseBounds, viewport);
        } else {
            const zoom = Math.min(
                Math.max(existing.camera.zoom, limits.minZoom),
                limits.maxZoom
            );
            camera = zoom === existing.camera.zoom
                ? clampCameraToBounds(
                    existing.camera,
                    baseBounds,
                    viewport,
                    limits.overscroll
                )
                : zoomCameraAt(
                    existing.camera,
                    zoom / existing.camera.zoom,
                    { x: viewport.width / 2, y: viewport.height / 2 },
                    limits,
                    baseBounds,
                    viewport
                );
        }
        const session = {
            sceneIdentity,
            camera,
            baseTransform,
            baseBounds,
            viewport,
            invalidResize: false
        };
        this.viewportSession = session;
        return session;
    }

    private cameraLimits(
        viewport: { readonly width: number; readonly height: number }
    ): CameraLimits {
        return {
            minZoom: this.settings.minZoom,
            maxZoom: this.settings.maxZoom,
            overscroll: viewportOverscroll(viewport)
        };
    }

    private panContextCamera(deltaX: number, deltaY: number): boolean {
        const session = this.viewportSession;
        if (!session || !this.canNavigateContext()) {
            return false;
        }
        return this.applyContextCamera(panCamera(
            session.camera,
            deltaX,
            deltaY,
            this.cameraLimits(session.viewport),
            session.baseBounds,
            session.viewport
        ));
    }

    private zoomContextCamera(factor: number, x: number, y: number): boolean {
        const session = this.viewportSession;
        if (!session || !this.canNavigateContext()) {
            return false;
        }
        return this.applyContextCamera(zoomCameraAt(
            session.camera,
            factor,
            { x, y },
            this.cameraLimits(session.viewport),
            session.baseBounds,
            session.viewport
        ));
    }

    private resetContextCamera(): boolean {
        const session = this.viewportSession;
        if (!session || !this.canNavigateContext()) {
            return false;
        }
        return this.applyContextCamera(resetCamera(
            this.cameraLimits(session.viewport),
            session.baseBounds,
            session.viewport
        ));
    }

    private beginContextPinch(x: number, y: number): ContextPinchSnapshot | null {
        const session = this.viewportSession;
        if (!session || !this.canNavigateContext()) {
            return null;
        }
        return createPinchSnapshot(session.camera, { x, y });
    }

    private pinchContextCamera(
        snapshot: ContextPinchSnapshot,
        distanceRatio: number,
        x: number,
        y: number
    ): boolean {
        const session = this.viewportSession;
        if (!session || !this.canNavigateContext()) {
            return false;
        }
        const limits = this.cameraLimits(session.viewport);
        return this.applyContextCamera(cameraFromPinchSnapshot(
            snapshot,
            distanceRatio,
            { x, y },
            limits,
            session.baseBounds,
            session.viewport
        ));
    }

    private applyContextCamera(camera: ContextCamera): boolean {
        const session = this.viewportSession;
        const rendered = this.renderedContext;
        if (!session || !rendered || !this.canNavigateContext()) {
            return false;
        }
        if (!rendered.setCamera(camera)) {
            return false;
        }
        this.viewportSession = { ...session, camera };
        this.resolveProbeFocus();
        return true;
    }

    private canNavigateContext(): boolean {
        const scene = this.focusedRenderSession?.scene;
        return scene !== undefined
            && this.navigationEnabledFor(scene)
            && this.host.hostCapabilities?.allowInteractions !== false;
    }

    private navigationEnabledFor(scene: ContextScene): boolean {
        if (this.settings.navigationMode === "off" || scene.mode === "none") {
            return false;
        }
        if (this.settings.navigationMode === "on") {
            return true;
        }
        return scene.backdrop.features.length > 1
            && this.settings.contextLayout !== "profileOnly"
            && this.host.hostCapabilities?.allowInteractions !== false;
    }

    private contextTarget(
        feature: ContextFeature,
        binding: ContextEntityBinding | null
    ): InteractionTarget {
        const identity = binding?.selection?.hostIdentity as ISelectionId | null ?? null;
        return {
            key: `context:${feature.key}`,
            element: this.contextSurface.root,
            identity,
            tooltip: () => [
                { displayName: this.localization.get("Tooltip_Entity"), value: feature.label },
                ...(binding?.tooltipValues ?? [{
                    displayName: this.localization.get("Context_DataState"),
                    value: this.localization.get("Context_NoData")
                }])
            ],
            activate: ({ multiSelect }) => {
                if (binding) {
                    this.commitEntitySelection(binding, multiSelect, "explicit");
                }
            }
        };
    }

    private resolveSelectedFeatureKeys(scene: ContextScene): ReadonlySet<string> {
        const keys = new Set<string>();
        if (this.externalSelection.length === 0) {
            return keys;
        }
        for (const [featureKey, binding] of scene.entities.byFeatureKey) {
            const identity = binding.selection?.hostIdentity as ISelectionId | null;
            if (identity && this.externalSelection.some((selection) => {
                const comparable = selection as unknown as powerbi.visuals.ISelectionId;
                return typeof comparable.equals === "function"
                    ? comparable.equals(identity as unknown as powerbi.visuals.ISelectionId)
                    : selection === identity;
            })) {
                keys.add(featureKey);
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

    private resolveProbeFocus(forceRender = false): void {
        const session = this.focusedRenderSession;
        const viewport = this.viewportSession;
        const rendered = this.renderedContext;
        const coverage = this.detailCoverage;
        const request = this.contextRenderRequest;
        if (
            !session
            || !viewport
            || !rendered
            || !coverage
            || !request
            || !this.canNavigateContext()
        ) {
            return;
        }
        const started = performance.now();
        const probe = centerProbe(
            request.viewport,
            composeSceneTransform(request.baseTransform, viewport.camera)
        );
        const hit = rendered.hitTest(probe.screen.x, probe.screen.y);
        const next = resolveFeatureFocus(
            session.scene,
            session.model,
            coverage,
            hit?.featureKey ?? null,
            this.selectedPeriodKey,
            this.fallbackResolution,
            "probe",
            this.modelRevision
        );
        const sameGeometry = this.lastProbeGeometryKey === (hit?.featureKey ?? null);
        this.lastProbeGeometryKey = hit?.featureKey ?? null;
        const duration = performance.now() - started;
        this.contextMetrics.probeResolutions++;
        this.contextMetrics.probeResolveDurationMs += duration;
        this.contextMetrics.maxProbeResolveDurationMs = Math.max(
            this.contextMetrics.maxProbeResolveDurationMs,
            duration
        );
        recordBoundedMetric(this.contextMetrics.probeResolveDurationsMs, duration);

        const current = this.activeContextFocus;
        if (sameGeometry && current?.renderToken === next.renderToken) {
            const sourceChanged = current.source !== next.source;
            this.activeContextFocus = next;
            this.syncFocusState(next);
            this.contextMetrics.probeDedupes++;
            if (forceRender) {
                this.renderFocusedProfileOnly();
            } else if (sourceChanged) {
                this.announceProbeFocus(next);
            }
            return;
        }
        this.activeContextFocus = next;
        this.syncFocusState(next);
        this.contextMetrics.probeTransitions++;
        this.renderFocusedProfileOnly();
    }

    private renderFocusedProfileOnly(): void {
        if (this.destroyed) {
            return;
        }
        const session = this.focusedRenderSession;
        const coverage = this.detailCoverage;
        if (!session || !coverage) {
            return;
        }
        const started = performance.now();
        const model = session.model;
        let focus = this.activeContextFocus;
        if (!focus) {
            const entityIndex = this.resolveEntityIndex(model);
            const featureKey = session.scene.entities.featureKeyByEntityKey.get(
                model.entities[entityIndex]?.key ?? ""
            );
            focus = resolveEntityFocus(
                model,
                coverage,
                entityIndex,
                this.selectedPeriodKey,
                "modelDefault",
                this.modelRevision,
                featureKey ? session.scene.backdrop.featureByKey.get(featureKey) ?? null : null,
                featureKey ? session.scene.entities.byFeatureKey.get(featureKey) ?? null : null
            );
            this.activeContextFocus = focus;
            this.syncFocusState(focus);
        }

        const hasLoadedProfile = focus.kind === "loadedEntity"
            || focus.kind === "fallbackEntity";
        const entityIndex = "entityIndex" in focus ? focus.entityIndex : 0;
        const periodIndex = focus.kind === "loadedEntity" || focus.kind === "fallbackEntity"
            ? focus.periodIndex
            : IMPLICIT_INDEX;
        const frameCells = hasLoadedProfile
            ? selectFrameCells(model.cells, { entityIndex, periodIndex })
            : [];
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
        const layout = computeProfileLayout({
            viewport: {
                width: session.profileRect.width,
                height: session.profileRect.height
            },
            profileCount: model.profiles.length,
            bandCount: model.bands.length,
            seriesCount: Math.max(model.series.length, 1),
            arrangement: this.settings.arrangement,
            armRotationDegrees: this.settings.armRotation,
            requestedBandGap: this.settings.bandGap,
            requestedThickness: this.settings.barThickness,
            showPeriodControl: this.settings.showPeriod
                && hasLoadedProfile
                && periodIndex !== IMPLICIT_INDEX,
            showLegend: this.settings.showLegend,
            showBandLabels: this.settings.showBandLabels,
            showValueLabels: this.settings.showValueLabels,
            showAxis: this.settings.showAxis,
            showHeader: this.settings.showHeader,
            showEntityList: !session.hasContext
                && this.settings.showEntityList
                && model.entities.length > 1
        });
        const presentation = this.focusPresentation(focus);
        const theme = resolveTheme(this.host.colorPalette, this.settings);
        const hadProfileFocus = this.svg.contains(document.activeElement);

        renderHeader(this.headerElement, {
            model,
            settings: this.settings,
            localization: this.localization,
            entityIndex,
            periodIndex,
            titleOverride: presentation.title,
            stateMessage: presentation.message,
            suppressEntityDetails: !hasLoadedProfile
        });
        if (!layout.chrome.header) {
            this.headerElement.setAttribute("hidden", "hidden");
        }

        const selectedKeys = hasLoadedProfile
            ? this.resolveSelectedTargetKeys(model, entityIndex, periodIndex)
            : new Set<string>();
        const rendered = renderProfiles(this.svg, {
            model,
            frame,
            layout,
            settings: this.settings,
            theme,
            localization: this.localization,
            entityIndex,
            periodIndex,
            interactive: session.allowInteractions && hasLoadedProfile,
            focusKey: this.controller.currentFocusKey ?? rememberedFocusKey(model),
            selectedKeys,
            measure: this.measure
        });

        const entityOptions = renderEntityList(this.entityElement, {
            model,
            localization: this.localization,
            entityIndex,
            visible: layout.chrome.entityList,
            interactive: session.allowInteractions
        });
        this.bindEntityOptions(entityOptions, model, session.allowInteractions);

        const periodControl = renderPeriodControl(this.periodElement, {
            model,
            localization: this.localization,
            entityIndex,
            periodIndex,
            visible: layout.chrome.periodControl && hasLoadedProfile,
            interactive: session.allowInteractions
        });
        this.periodElement.style.order = this.settings.periodPosition === "top" ? "2" : "5";
        this.bindPeriodControl(
            periodControl.slider,
            model,
            entityIndex,
            periodIndex,
            session.allowInteractions
        );

        renderAccessibleTable(this.tableElement, {
            model,
            frame,
            localization: this.localization,
            entityIndex,
            periodIndex,
            visible: this.settings.tableVisibility === "visible",
            entityLabelOverride: presentation.title,
            emptyMessage: hasLoadedProfile ? undefined : presentation.message
        });

        if (this.renderedContext && this.contextRenderRequest) {
            const dynamicRequest: ContextRenderRequest = {
                ...this.contextRenderRequest,
                scene: session.scene,
                focusedFeatureKey: focus.featureKey,
                selectedFeatureKeys: this.resolveSelectedFeatureKeys(session.scene),
                featureDescriptions: this.contextFeatureDescriptions(
                    session.scene,
                    session.sceneIdentity
                ),
                connectorTarget: focus.featureKey ? session.connectorTarget : undefined
            };
            this.contextRenderRequest = dynamicRequest;
            this.renderedContext.updateDynamic(dynamicRequest);
            this.contextMetrics.dynamicOverlayUpdates++;
        }

        this.pendingProfileTargets = hasLoadedProfile
            ? this.buildTargets(rendered, model, frame, entityIndex, periodIndex)
            : [];
        if (!this.controller.navigationInProgress) {
            this.controller.bind(this.pendingProfileTargets, session.contextInteraction);
            this.controller.restoreFocus(hadProfileFocus);
        }

        const statusDiagnostics = [...model.diagnostics, ...session.scene.diagnostics];
        if (this.fallbackResolution.kind === "invalid") {
            statusDiagnostics.push({
                code: "fallbackEntityInvalid",
                severity: severityOf("fallbackEntityInvalid"),
                messageKey: messageKeyFor("fallbackEntityInvalid")
            });
        }
        if (this.runtimeSelectionRejected) {
            statusDiagnostics.push({
                code: "hostSelectionRejected",
                severity: severityOf("hostSelectionRejected"),
                messageKey: messageKeyFor("hostSelectionRejected")
            });
        }
        if (!session.allowInteractions) {
            statusDiagnostics.push({
                code: "interactionsDisabled",
                severity: severityOf("interactionsDisabled"),
                messageKey: messageKeyFor("interactionsDisabled")
            });
        }
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
        const coverageSummary = this.contextCoverageSummary(session.scene);
        const rejectionAnnouncement = this.runtimeSelectionRejectionNeedsAnnouncement
            ? ` ${this.localization.get("Context_SelectionRejected")}`
            : "";
        const summary = `${presentation.summary} ${coverageSummary}${rejectionAnnouncement}`;
        const announceStatus = focus.source !== "probe"
            || this.runtimeSelectionRejectionNeedsAnnouncement;
        renderStatus(this.statusElement, {
            model: {
                ...model,
                diagnostics: statusDiagnostics.sort(compareDiagnostics)
            },
            localization: this.localization,
            showDiagnostics: this.settings.showDiagnostics,
            showCounts: this.settings.showCounts,
            summary,
            busy: model.segments.partial,
            announce: announceStatus
        });
        this.runtimeSelectionRejectionNeedsAnnouncement = false;
        if (!layout.chrome.status) {
            this.statusElement.classList.add("profile-lens-status-sr");
        } else {
            this.statusElement.classList.remove("profile-lens-status-sr");
        }

        this.announceProbeFocus(focus);
        const duration = performance.now() - started;
        this.contextMetrics.profilePartialUpdates++;
        this.contextMetrics.profilePartialDurationMs += duration;
        this.contextMetrics.maxProfilePartialDurationMs = Math.max(
            this.contextMetrics.maxProfilePartialDurationMs,
            duration
        );
        recordBoundedMetric(this.contextMetrics.profilePartialDurationsMs, duration);
    }

    private handleFocusedTarget(
        key: string | null,
        source: InteractionFocusSource
    ): void {
        const session = this.focusedRenderSession;
        const coverage = this.detailCoverage;
        if (!key?.startsWith("context:") || !session || !coverage) {
            return;
        }
        const featureKey = key.slice("context:".length);
        if (!this.navigationEnabledFor(session.scene)) {
            this.selectedPeriodKey = null;
        }
        const next = resolveFeatureFocus(
            session.scene,
            session.model,
            coverage,
            featureKey,
            this.selectedPeriodKey,
            { kind: "disabled" },
            source === "keyboard" ? "contextKeyboard" : "contextPointer",
            this.modelRevision
        );
        const changed = this.activeContextFocus?.renderToken !== next.renderToken
            || this.activeContextFocus?.source !== next.source;
        this.activeContextFocus = next;
        this.syncFocusState(next);
        if (changed) {
            this.renderFocusedProfileOnly();
        }
    }

    private activateEntityHost(entity: ProfileDataModel["entities"][number]): void {
        if (
            this.activeContextFocus?.kind === "loadedEntity"
            && this.activeContextFocus.entityKey === entity.key
        ) {
            this.requestEntitySelection(
                entity.key,
                entity.identity as ISelectionId | null,
                false,
                "explicit"
            );
        }
    }

    private handleContextMoveEnd(): void {
        if (!this.canNavigateContext()) {
            return;
        }
        this.resolveProbeFocus();
        this.bindFocusedInteractions();
        const focus = this.activeContextFocus;
        if (focus?.kind !== "loadedEntity" || !focus.binding) {
            return;
        }
        this.commitEntitySelection(focus.binding, false, "settle");
    }

    private bindFocusedInteractions(): void {
        const session = this.focusedRenderSession;
        if (!session) {
            return;
        }
        const hadProfileFocus = this.svg.contains(document.activeElement);
        this.controller.bind(this.pendingProfileTargets, session.contextInteraction, true);
        this.controller.restoreFocus(hadProfileFocus);
    }

    private commitEntitySelection(
        binding: ContextEntityBinding,
        multiSelect: boolean,
        source: "explicit" | "settle"
    ): void {
        const focus = this.activeContextFocus;
        if (
            focus?.kind !== "loadedEntity"
            || focus.entityKey !== binding.entityKey
        ) {
            return;
        }
        this.requestEntitySelection(
            binding.entityKey,
            binding.selection?.hostIdentity as ISelectionId | null,
            multiSelect,
            source
        );
    }

    private requestEntitySelection(
        entityKey: string,
        identity: ISelectionId | null,
        multiSelect: boolean,
        source: "explicit" | "settle"
    ): void {
        if (
            this.settings.interactionMode !== "reportSelection"
            || !identity
            || this.host.hostCapabilities?.allowInteractions === false
        ) {
            return;
        }
        if (
            source === "settle"
            && this.selectionInFlight === null
            && this.selectionQueue.length === 0
            && this.lastCommittedEntityKey === entityKey
        ) {
            return;
        }
        this.enqueueSelection({
            sequence: ++this.selectionSequence,
            generation: this.selectionGeneration,
            kind: "entity",
            source,
            key: `entity:${selectionIdentityKey(identity)}`,
            identity,
            multiSelect,
            entityKey
        });
    }

    private requestProfileSelection(
        identity: ISelectionId,
        multiSelect: boolean
    ): void {
        if (this.host.hostCapabilities?.allowInteractions === false) {
            return;
        }
        this.enqueueSelection({
            sequence: ++this.selectionSequence,
            generation: this.selectionGeneration,
            kind: "profile",
            source: "profile",
            key: `profile:${selectionIdentityKey(identity)}`,
            identity,
            multiSelect
        });
    }

    private enqueueSelection(operation: LocalSelectionOperation): void {
        if (this.destroyed) {
            return;
        }
        if (!operation.multiSelect) {
            const removed = this.selectionQueue.length;
            if (removed > 0) {
                this.selectionQueue.splice(0, removed);
                this.contextMetrics.hostSelectionCoalesced += removed;
            }
            if (
                this.selectionInFlight
                && this.selectionInFlight.generation === this.selectionGeneration
                && selectionOperationsEqual(this.selectionInFlight, operation)
            ) {
                this.contextMetrics.hostSelectionCoalesced++;
                return;
            }
        }
        this.selectionQueue.push(operation);
        this.contextMetrics.hostSelectionQueued++;
        this.pumpSelectionQueue();
    }

    private pumpSelectionQueue(): void {
        if (this.destroyed) {
            this.selectionQueue.splice(0);
            return;
        }
        if (this.selectionInFlight || this.selectionQueue.length === 0) {
            return;
        }
        const operation = this.selectionQueue.shift()!;
        if (operation.generation !== this.selectionGeneration) {
            this.contextMetrics.hostSelectionStale++;
            this.pumpSelectionQueue();
            return;
        }
        this.selectionInFlight = operation;
        this.contextMetrics.hostSelectionInFlight = 1;
        this.contextMetrics.maxHostSelectionInFlight = Math.max(
            this.contextMetrics.maxHostSelectionInFlight,
            this.contextMetrics.hostSelectionInFlight
        );
        this.contextMetrics.hostSelectionRequests++;
        void this.selectionManager.select(operation.identity, operation.multiSelect).then(
            (ids) => {
                this.completeSelection(operation, Array.isArray(ids)
                    ? ids
                    : this.selectionManager.getSelectionIds(), null);
            },
            (error) => {
                this.completeSelection(operation, null, error);
            }
        );
    }

    private completeSelection(
        operation: LocalSelectionOperation,
        ids: readonly ISelectionId[] | null,
        error: unknown
    ): void {
        if (this.selectionInFlight?.sequence !== operation.sequence) {
            this.contextMetrics.hostSelectionStale++;
            return;
        }
        this.selectionInFlight = null;
        this.contextMetrics.hostSelectionInFlight = 0;
        if (this.destroyed) {
            this.contextMetrics.hostSelectionStale++;
            this.selectionQueue.splice(0);
            return;
        }
        if (operation.generation !== this.selectionGeneration) {
            this.contextMetrics.hostSelectionStale++;
            if (error === null) {
                this.externalSelection = this.selectionManager.getSelectionIds();
                this.reconcileCommittedEntitySelection();
            } else {
                this.contextMetrics.hostSelectionRejected++;
                this.runtimeSelectionRejected = true;
                this.runtimeSelectionRejectionNeedsAnnouncement = true;
            }
            this.requestSelectionStateRender();
            this.pumpSelectionQueue();
            return;
        }
        if (error === null) {
            this.contextMetrics.hostSelectionResolved++;
            this.runtimeSelectionRejected = false;
            this.runtimeSelectionRejectionNeedsAnnouncement = false;
            this.lastCommittedEntityKey = operation.kind === "entity"
                && !operation.multiSelect
                ? operation.entityKey ?? null
                : null;
            this.externalSelection = ids ?? this.selectionManager.getSelectionIds();
        } else {
            this.contextMetrics.hostSelectionRejected++;
            this.runtimeSelectionRejected = true;
            this.runtimeSelectionRejectionNeedsAnnouncement = true;
        }
        this.requestSelectionStateRender();
        this.pumpSelectionQueue();
    }

    private handleExternalSelection(ids: readonly ISelectionId[]): void {
        if (this.destroyed) {
            return;
        }
        this.controller.cancelPendingNavigationSettle();
        this.externalSelection = ids;
        this.invalidateQueuedSelections(true);
        this.reconcileCommittedEntitySelection();
        this.selectionRenderPending = true;
        this.flushSelectionStateRender();
    }

    private invalidateQueuedSelections(external = false): void {
        this.selectionGeneration++;
        if (this.selectionQueue.length > 0) {
            this.contextMetrics.hostSelectionCoalesced += this.selectionQueue.length;
            this.selectionQueue.splice(0);
        }
        if (external) {
            this.contextMetrics.hostSelectionExternalInvalidations++;
        }
    }

    private requestSelectionStateRender(): void {
        if (this.destroyed) {
            return;
        }
        if (this.deferredHostUpdate) {
            this.selectionRenderPending = true;
            if (!this.controller.navigationInProgress) {
                this.flushSelectionStateRender();
            }
            return;
        }
        if (
            this.activePointerPresses.size > 0
            || this.postReleaseClickGrace
            || this.controller.navigationInProgress
        ) {
            this.selectionRenderPending = true;
            if (this.postReleaseClickGrace) {
                this.scheduleSelectionRenderFallback();
            }
            return;
        }
        this.clearSelectionRenderTimer();
        this.selectionRenderPending = false;
        this.renderFocusedProfileOnly();
    }

    private flushSelectionStateRender(): void {
        if (
            !this.hasDeferredRender()
            || this.destroyed
            || this.activePointerPresses.size > 0
            || this.postReleaseClickGrace
            || this.controller.navigationInProgress
        ) {
            return;
        }
        this.clearSelectionRenderTimer();
        if (this.deferredHostUpdate) {
            const update = this.deferredHostUpdate;
            this.deferredHostUpdate = null;
            const options = this.deferredHostOptions.splice(0);
            this.selectionRenderPending = false;
            this.executeHostUpdate(
                update.options,
                options,
                update.dataViewIdentity
            );
            return;
        }
        this.selectionRenderPending = false;
        this.renderFocusedProfileOnly();
    }

    private shouldDeferHostUpdate(): boolean {
        return this.activePointerPresses.size > 0
            || this.postReleaseClickGrace
            || this.controller.navigationInProgress;
    }

    private coalesceHostUpdate(
        current: DeferredHostUpdate | null,
        next: VisualUpdateOptions
    ): DeferredHostUpdate {
        if (current?.options.dataViews?.[0] === undefined) {
            return {
                options: next,
                dataViewIdentity: next.dataViews?.[0] ?? null
            };
        }
        const currentOptions = current.options;
        const nextDataView = next.dataViews?.[0];
        const lifecycleOnly = nextDataView === undefined
            || (
                (
                    nextDataView === this.lastDataView
                    || nextDataView === this.lastDataViewIdentity
                )
                && fingerprintDataView(nextDataView) === this.lastFingerprint
            )
            || nextDataView === current.dataViewIdentity;
        if (!lifecycleOnly) {
            return {
                options: next,
                dataViewIdentity: nextDataView ?? null
            };
        }
        const pendingDataView = currentOptions.dataViews[0];
        const latestObjects = nextDataView
            && Object.prototype.hasOwnProperty.call(nextDataView.metadata, "objects")
            ? nextDataView.metadata.objects
            : pendingDataView.metadata.objects;
        const mergedDataView: powerbi.DataView = {
            ...pendingDataView,
            metadata: {
                ...pendingDataView.metadata,
                objects: latestObjects
            }
        };
        return {
            options: {
                ...next,
                dataViews: [
                    mergedDataView,
                    ...currentOptions.dataViews.slice(1)
                ],
                operationKind: currentOptions.operationKind
            },
            dataViewIdentity: current.dataViewIdentity ?? pendingDataView
        };
    }

    private executeHostUpdate(
        update: VisualUpdateOptions,
        lifecycleOptions: readonly VisualUpdateOptions[],
        dataViewIdentity: powerbi.DataView | null
    ): void {
        try {
            this.applyUpdate(update);
            if (update.dataViews?.[0] !== undefined) {
                this.lastDataViewIdentity = dataViewIdentity ?? update.dataViews[0];
            }
            for (const options of lifecycleOptions) {
                this.host.eventService.renderingFinished(options);
            }
        } catch (error) {
            this.renderFailure(error);
            for (const options of lifecycleOptions) {
                this.host.eventService.renderingFailed(options, describeError(error));
            }
        }
    }

    private hasDeferredRender(): boolean {
        return this.selectionRenderPending || this.deferredHostUpdate !== null;
    }

    private scheduleSelectionRenderFallback(): void {
        this.clearSelectionRenderTimer();
        this.selectionRenderTimer = setTimeout(() => {
            this.selectionRenderTimer = null;
            this.postReleaseClickGrace = false;
            this.flushSelectionStateRender();
        }, 0);
    }

    private clearSelectionRenderTimer(): void {
        if (this.selectionRenderTimer !== null) {
            clearTimeout(this.selectionRenderTimer);
            this.selectionRenderTimer = null;
        }
    }

    private failDeferredHostRenders(error: Error): void {
        for (const options of this.deferredHostOptions.splice(0)) {
            this.host.eventService.renderingFailed(options, error.message);
        }
    }

    private reconcileCommittedEntitySelection(): void {
        const scene = this.focusedRenderSession?.scene;
        if (!scene || this.externalSelection.length !== 1) {
            this.lastCommittedEntityKey = null;
            return;
        }
        const selected = this.externalSelection[0];
        for (const binding of scene.entities.byFeatureKey.values()) {
            const identity = binding.selection?.hostIdentity as ISelectionId | null;
            if (identity && selectionEquals(selected, identity)) {
                this.lastCommittedEntityKey = binding.entityKey;
                return;
            }
        }
        this.lastCommittedEntityKey = null;
    }

    private syncFocusState(focus: ContextFocusState): void {
        if (
            focus.kind === "loadedEntity"
            || focus.kind === "unloadedEntity"
            || focus.kind === "fallbackEntity"
        ) {
            this.focusedEntityKey = focus.entityKey;
        } else {
            this.focusedEntityKey = null;
        }
        if (focus.kind === "loadedEntity" || focus.kind === "fallbackEntity") {
            this.selectedPeriodKey = focus.periodKey;
        }
        if (focus.source === "probe") {
            this.controller.setSurfaceFocusKey(
                focus.featureKey === null ? null : `context:${focus.featureKey}`
            );
        }
    }

    private fullRenderRepresentsFocus(
        focus: ContextFocusState | null,
        entityIndex: number,
        periodIndex: number
    ): boolean {
        return focus?.kind === "loadedEntity"
            && focus.entityIndex === entityIndex
            && focus.periodIndex === periodIndex;
    }

    private reconcileActiveFocus(
        model: ProfileDataModel,
        scene: ContextScene,
        defaultEntityIndex: number
    ): void {
        const coverage = this.detailCoverage;
        if (!coverage) {
            return;
        }
        const current = this.activeContextFocus;
        let next: ContextFocusState;
        if (
            model.entities.length === 0
            && current?.featureKey
            && scene.backdrop.featureByKey.has(current.featureKey)
        ) {
            next = resolveFeatureFocus(
                scene,
                model,
                coverage,
                current.featureKey,
                this.selectedPeriodKey,
                this.fallbackResolution,
                current.source,
                this.modelRevision
            );
        } else if (model.entities.length === 0) {
            next = resolveFeatureFocus(
                scene,
                model,
                coverage,
                null,
                this.selectedPeriodKey,
                this.fallbackResolution,
                scene.mode === "none" ? "modelDefault" : current?.source ?? "modelDefault",
                this.modelRevision
            );
        } else if (scene.mode === "none" || scene.backdrop.features.length === 0) {
            const currentEntityKey = current && "entityKey" in current
                ? current.entityKey
                : this.focusedEntityKey;
            const currentIndex = currentEntityKey
                ? model.entities.findIndex((entity) => entity.key === currentEntityKey)
                : -1;
            next = resolveEntityFocus(
                model,
                coverage,
                currentIndex >= 0 ? currentIndex : defaultEntityIndex,
                this.selectedPeriodKey,
                "modelDefault",
                this.modelRevision
            );
        } else if (current?.featureKey && scene.backdrop.featureByKey.has(current.featureKey)) {
            next = resolveFeatureFocus(
                scene,
                model,
                coverage,
                current.featureKey,
                this.selectedPeriodKey,
                this.fallbackResolution,
                current.source,
                this.modelRevision
            );
        } else if (current?.kind === "noFeature" || current?.kind === "fallbackEntity") {
            next = resolveFeatureFocus(
                scene,
                model,
                coverage,
                null,
                this.selectedPeriodKey,
                this.fallbackResolution,
                current.source,
                this.modelRevision
            );
        } else {
            const entityKey = current && "entityKey" in current
                ? current.entityKey
                : this.focusedEntityKey;
            const entityIndex = entityKey
                ? model.entities.findIndex((entity) => entity.key === entityKey)
                : -1;
            const resolvedIndex = entityIndex >= 0 ? entityIndex : defaultEntityIndex;
            const resolvedEntityKey = model.entities[resolvedIndex]?.key ?? "";
            const featureKey = scene.entities.featureKeyByEntityKey.get(resolvedEntityKey);
            next = resolveEntityFocus(
                model,
                coverage,
                resolvedIndex,
                this.selectedPeriodKey,
                current?.source ?? "modelDefault",
                this.modelRevision,
                featureKey ? scene.backdrop.featureByKey.get(featureKey) ?? null : null,
                featureKey ? scene.entities.byFeatureKey.get(featureKey) ?? null : null
            );
        }
        this.activeContextFocus = next;
        this.syncFocusState(next);
    }

    private canRenderBindingFreeContext(): boolean {
        return this.settings.contextMode === "builtInPack"
            && this.settings.contextLayout !== "profileOnly";
    }

    private focusPresentation(focus: ContextFocusState): {
        readonly title: string;
        readonly message?: string;
        readonly summary: string;
    } {
        switch (focus.kind) {
            case "loadedEntity":
                return {
                    title: focus.entityLabel,
                    summary: this.localization.format(
                        "Status_Ready",
                        this.model?.bands.length ?? 0,
                        this.model?.profiles.length ?? 0,
                        focus.entityLabel
                    )
                };
            case "fallbackEntity":
                return {
                    title: focus.entityLabel,
                    message: this.localization.get("Context_Fallback"),
                    summary: `${this.localization.format(
                        "Status_Ready",
                        this.model?.bands.length ?? 0,
                        this.model?.profiles.length ?? 0,
                        focus.entityLabel
                    )} ${this.localization.get("Context_Fallback")}.`
                };
            case "unboundFeature":
                return {
                    title: focus.feature.label,
                    message: this.localization.get("Context_NoData"),
                    summary: `${focus.feature.label}. ${this.localization.get("Context_NoData")}.`
                };
            case "unloadedEntity":
                return {
                    title: focus.feature?.label ?? focus.entityLabel,
                    message: this.localization.get("Context_Unloaded"),
                    summary: `${focus.feature?.label ?? focus.entityLabel}. `
                        + `${this.localization.get("Context_Unloaded")}.`
                };
            case "noFeature":
                return {
                    title: this.localization.get("Context_NoFeature"),
                    message: this.localization.get("Context_NoData"),
                    summary: `${this.localization.get("Context_NoFeature")}.`
                };
        }
    }

    private contextFeatureDescriptions(
        scene: ContextScene,
        sceneIdentity: string
    ): ReadonlyMap<string, string> {
        const cacheKey = `${this.modelRevision}|${sceneIdentity}`;
        if (this.contextDescriptionCache?.key === cacheKey) {
            return this.contextDescriptionCache.descriptions;
        }
        const descriptions = new Map<string, string>();
        for (const feature of scene.backdrop.features) {
            const binding = scene.entities.byFeatureKey.get(feature.key);
            const loaded = binding
                ? (this.detailCoverage?.loadedPeriodIndexesByEntity.get(binding.entityIndex)?.size ?? 0)
                    > 0
                : false;
            const state = !binding
                ? this.localization.get("Context_NoData")
                : loaded
                    ? this.localization.get("Context_DataAvailable")
                    : this.localization.get("Context_Unloaded");
            const contextValue = binding?.contextValue === null
                || binding?.contextValue === undefined
                ? ""
                : ` ${this.localization.get("Header_ContextValue")}: `
                    + `${this.localization.formatNumber(binding.contextValue)}.`;
            descriptions.set(
                feature.key,
                `${feature.description}.${contextValue} ${state}.`
            );
        }
        this.contextDescriptionCache = { key: cacheKey, descriptions };
        return descriptions;
    }

    private contextCoverageSummary(scene: ContextScene): string {
        let loaded = 0;
        let unloaded = 0;
        for (const binding of scene.entities.byFeatureKey.values()) {
            if (
                (this.detailCoverage?.loadedPeriodIndexesByEntity.get(binding.entityIndex)?.size ?? 0)
                > 0
            ) {
                loaded++;
            } else {
                unloaded++;
            }
        }
        const matched = scene.entities.byFeatureKey.size;
        const unbound = Math.max(scene.backdrop.features.length - matched, 0);
        return this.localization.format("Context_Coverage", loaded, matched, unloaded, unbound);
    }

    private announceProbeFocus(focus: ContextFocusState): void {
        if (focus.source !== "probe" || !this.canNavigateContext()) {
            this.clearProbeAnnouncement();
            this.lastProbeAnnouncementToken = null;
            return;
        }
        if (focus.announcementToken === this.lastProbeAnnouncementToken) {
            return;
        }
        let message: string;
        switch (focus.kind) {
            case "loadedEntity":
                message = this.localization.format(
                    "Context_AnnouncementLoaded",
                    focus.entityLabel
                );
                break;
            case "unboundFeature":
                message = this.localization.format(
                    "Context_AnnouncementNoData",
                    focus.feature.label
                );
                break;
            case "unloadedEntity":
                message = this.localization.format(
                    "Context_AnnouncementUnloaded",
                    focus.feature?.label ?? focus.entityLabel
                );
                break;
            case "fallbackEntity":
                message = this.localization.format(
                    "Context_AnnouncementFallback",
                    focus.entityLabel
                );
                break;
            case "noFeature":
                message = this.localization.get("Context_AnnouncementNoFeature");
                break;
        }
        if (
            this.settings.probeAnnouncementVerbosity === "detailed"
            && this.focusedRenderSession
        ) {
            message += ` ${this.contextCoverageSummary(this.focusedRenderSession.scene)}`;
        }
        if (
            this.lastProbeAnnouncementToken === null
            && this.probeAnnouncementTimer === null
        ) {
            this.probeAnnouncementElement.textContent = message;
            this.lastProbeAnnouncementToken = focus.announcementToken;
            return;
        }
        this.pendingProbeAnnouncement = {
            message,
            token: focus.announcementToken
        };
        if (this.probeAnnouncementTimer !== null) {
            return;
        }
        this.probeAnnouncementTimer = setTimeout(() => {
            this.probeAnnouncementTimer = null;
            const pending = this.pendingProbeAnnouncement;
            this.pendingProbeAnnouncement = null;
            if (
                !pending
                || !this.canNavigateContext()
                || this.activeContextFocus?.source !== "probe"
                || this.activeContextFocus.announcementToken !== pending.token
            ) {
                return;
            }
            this.probeAnnouncementElement.textContent = pending.message;
            this.lastProbeAnnouncementToken = pending.token;
        }, 250);
    }

    private clearProbeAnnouncement(): void {
        if (this.probeAnnouncementTimer !== null) {
            clearTimeout(this.probeAnnouncementTimer);
            this.probeAnnouncementTimer = null;
        }
        this.pendingProbeAnnouncement = null;
    }

    private clearFocusedRenderSession(): void {
        this.invalidateQueuedSelections();
        this.focusedRenderSession = null;
        this.contextRenderRequest = null;
        this.renderedContext = null;
        this.activeContextFocus = null;
        this.pendingProfileTargets = [];
        this.focusedEntityKey = null;
        this.selectedPeriodKey = null;
        this.lastProbeGeometryKey = null;
        this.runtimeSelectionRejected = false;
        this.runtimeSelectionRejectionNeedsAnnouncement = false;
        this.clearProbeAnnouncement();
        this.probeAnnouncementElement.textContent = "";
        this.lastProbeAnnouncementToken = null;
        clear(this.svg);
        hideContextSurface(this.contextSurface);
    }

    private buildTargets(
        rendered: readonly RenderedTarget[],
        model: ProfileDataModel,
        frame: NormalizedFrame,
        entityIndex: number,
        periodIndex: number
    ): readonly InteractionTarget[] {
        return rendered.map((target) => {
            const identity = (model.bandIdentities.get(
                bandIdentityKey(entityIndex, periodIndex, target.bandIndex)
            ) as ISelectionId | undefined) ?? null;
            return {
                key: target.key,
                element: target.element,
                identity,
                tooltip: () =>
                    this.buildTooltipItems(model, frame, target, entityIndex, periodIndex),
                activate: ({ multiSelect }) => {
                    if (identity) {
                        this.requestProfileSelection(identity, multiSelect);
                    }
                }
            };
        });
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
        const focusEntity = (index: number): boolean => {
            if (!this.canMutateInteractions()) {
                this.root.focus();
                return false;
            }
            const session = this.focusedRenderSession;
            const coverage = this.detailCoverage;
            const entity = model.entities[index];
            if (!session || !coverage || !entity) {
                return false;
            }
            this.selectedPeriodKey = null;
            const featureKey = session.scene.entities.featureKeyByEntityKey.get(entity.key);
            const next = resolveEntityFocus(
                model,
                coverage,
                index,
                null,
                "entityList",
                this.modelRevision,
                featureKey ? session.scene.backdrop.featureByKey.get(featureKey) ?? null : null,
                featureKey ? session.scene.entities.byFeatureKey.get(featureKey) ?? null : null
            );
            this.activeContextFocus = next;
            this.syncFocusState(next);
            this.renderFocusedProfileOnly();
            this.entityElement
                .querySelector<HTMLElement>(`[data-entity-index="${index}"]`)
                ?.focus();
            return true;
        };
        for (const option of options) {
            option.element.addEventListener("focus", () => {
                if (!this.canMutateInteractions()) {
                    this.root.focus();
                }
            });
            option.element.addEventListener("click", () => {
                if (!focusEntity(option.index)) {
                    return;
                }
                const entity = model.entities[option.index];
                if (entity) {
                    this.activateEntityHost(entity);
                }
            });
            option.element.addEventListener("keydown", (event: KeyboardEvent) => {
                if (!this.canMutateInteractions()) {
                    this.root.focus();
                    return;
                }
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
        slider.addEventListener("focus", () => {
            if (!this.canMutateInteractions()) {
                this.root.focus();
            }
        });
        slider.addEventListener("keydown", (event: KeyboardEvent) => {
            if (!this.canMutateInteractions()) {
                this.root.focus();
                return;
            }
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
            const coverage = this.detailCoverage;
            const focus = this.activeContextFocus;
            const scene = this.focusedRenderSession?.scene;
            if (coverage && focus && scene) {
                this.activeContextFocus = focus.kind === "fallbackEntity"
                    ? resolveFeatureFocus(
                        scene,
                        model,
                        coverage,
                        null,
                        this.selectedPeriodKey,
                        this.fallbackResolution,
                        focus.source,
                        this.modelRevision
                    )
                    : "entityIndex" in focus
                        ? resolveEntityFocus(
                            model,
                            coverage,
                            focus.entityIndex,
                            this.selectedPeriodKey,
                            focus.source,
                            this.modelRevision,
                            focus.feature,
                            "binding" in focus ? focus.binding : null
                        )
                        : focus;
                this.syncFocusState(this.activeContextFocus);
            }
            this.renderFocusedProfileOnly();
            const sliderFocus = this.periodElement.querySelector<HTMLElement>(
                ".profile-lens-period-slider"
            );
            sliderFocus?.focus();
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

    private canMutateInteractions(): boolean {
        return !this.destroyed
            && this.host.hostCapabilities?.allowInteractions !== false;
    }

    private applyThemeVariables(theme: ReturnType<typeof resolveTheme>): void {
        const selected = theme.isHighContrast
            ? theme.foregroundSelected
            : this.settings.contextSelectedColor;
        this.root.style.setProperty("--profile-lens-foreground", theme.foreground);
        this.root.style.setProperty("--profile-lens-background", theme.background);
        this.root.style.setProperty("--profile-lens-selected", selected);
        this.root.style.setProperty(
            "--profile-lens-muted",
            theme.isHighContrast ? theme.foreground : "#605E5C"
        );
        this.root.style.setProperty(
            "--profile-lens-border",
            theme.isHighContrast ? theme.foreground : "#E1DFDD"
        );
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

function resolvePackId(
    pack: "worldCountries" | "usStates" | "usCounties",
    worldDetail: "110m" | "50m"
): string {
    if (pack === "worldCountries") {
        return `world-countries-${worldDetail}`;
    }
    return pack === "usStates" ? "us-states-2025-5m" : "us-counties-2025-5m";
}

function resolvePackKeyMode(
    pack: "worldCountries" | "usStates" | "usCounties",
    selected: "auto" | "canonical" | "isoAlpha3CaseFold" | "geoid2" | "geoid5"
): string {
    if (selected !== "auto") {
        return selected;
    }
    return pack === "worldCountries" ? "canonical" : pack === "usStates" ? "geoid2" : "geoid5";
}

function contextPaintIdentity(scene: ContextScene, showNoDataBackdrop: boolean): string {
    if (showNoDataBackdrop) {
        return "all-backdrop";
    }
    return `bound-only:${[...scene.entities.byFeatureKey.keys()].sort().join(",")}`;
}

function selectionOperationsEqual(
    left: LocalSelectionOperation,
    right: LocalSelectionOperation
): boolean {
    return left.key === right.key && left.multiSelect === right.multiSelect;
}

function selectionIdentityKey(identity: ISelectionId): string {
    return (identity as unknown as powerbi.visuals.ISelectionId).getKey();
}

function selectionEquals(left: ISelectionId, right: ISelectionId): boolean {
    const comparable = left as unknown as powerbi.visuals.ISelectionId;
    return typeof comparable.equals === "function"
        ? comparable.equals(right as unknown as powerbi.visuals.ISelectionId)
        : left === right;
}

function recordBoundedMetric(values: number[], value: number): void {
    values.push(value);
    if (values.length > 128) {
        values.shift();
    }
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
