import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import {
    Arrangement,
    BlankPolicy,
    LIMITS,
    NormalizationMode,
    PercentScale,
    TableVisibility,
    TextDirection
} from "./model/contract";
import type { ContextMode } from "./context/contract";
import type { ContextLayoutMode } from "./layout/contextLayout";
import type { DetailStrategyId } from "./detail/contract";

import Card = formattingSettings.SimpleCard;
import Model = formattingSettings.Model;

// powerbi.visuals.ValidatorType is an ambient const enum. Per-file transpilers such as esbuild do
// not inline ambient const enum members, so the literal values are declared here with their exact
// enum types instead of being read from the namespace at runtime.
const MIN_VALIDATOR: powerbi.visuals.ValidatorType.Min = 0;
const MAX_VALIDATOR: powerbi.visuals.ValidatorType.Max = 1;

function numberOptions(min: number, max: number): powerbi.visuals.NumUpDownFormat {
    return {
        minValue: { type: MIN_VALIDATOR, value: min },
        maxValue: { type: MAX_VALIDATOR, value: max }
    };
}

export class DataCard extends Card {
    public override name = "data";
    public override displayNameKey = "Format_Data_Card";

    public normalization = new formattingSettings.AutoDropdown({
        name: "normalization",
        displayNameKey: "Format_Normalization",
        value: "raw"
    });

    public percentScale = new formattingSettings.AutoDropdown({
        name: "percentScale",
        displayNameKey: "Format_PercentScale",
        value: "fraction"
    });

    public blankPolicy = new formattingSettings.AutoDropdown({
        name: "blankPolicy",
        displayNameKey: "Format_BlankPolicy",
        value: "missing"
    });

    public maxProfiles = new formattingSettings.NumUpDown({
        name: "maxProfiles",
        displayNameKey: "Format_MaxProfiles",
        value: LIMITS.maxProfiles,
        options: numberOptions(1, LIMITS.maxProfiles)
    });

    public maxSeries = new formattingSettings.NumUpDown({
        name: "maxSeries",
        displayNameKey: "Format_MaxSeries",
        value: LIMITS.maxSeries,
        options: numberOptions(1, LIMITS.maxSeries)
    });

    public override slices = [
        this.normalization,
        this.percentScale,
        this.blankPolicy,
        this.maxProfiles,
        this.maxSeries
    ];
}

export class LayoutCard extends Card {
    public override name = "layout";
    public override displayNameKey = "Format_Layout_Card";

    public arrangement = new formattingSettings.AutoDropdown({
        name: "arrangement",
        displayNameKey: "Format_Arrangement",
        value: "auto"
    });

    public contextLayout = new formattingSettings.AutoDropdown({
        name: "contextLayout",
        displayNameKey: "Format_ContextLayout",
        value: "split"
    });

    public armRotation = new formattingSettings.NumUpDown({
        name: "armRotation",
        displayNameKey: "Format_ArmRotation",
        value: 0,
        options: numberOptions(0, 359)
    });

    public bandGap = new formattingSettings.NumUpDown({
        name: "bandGap",
        displayNameKey: "Format_BandGap",
        value: 1,
        options: numberOptions(0, 12)
    });

    public showEntityList = new formattingSettings.ToggleSwitch({
        name: "showEntityList",
        displayNameKey: "Format_ShowEntityList",
        value: true
    });

    public direction = new formattingSettings.AutoDropdown({
        name: "direction",
        displayNameKey: "Format_Direction",
        value: "auto"
    });

    public override slices = [
        this.arrangement,
        this.contextLayout,
        this.armRotation,
        this.bandGap,
        this.showEntityList,
        this.direction
    ];
}

export class ContextCard extends Card {
    public override name = "context";
    public override displayNameKey = "Format_Context_Card";

    public mode = new formattingSettings.AutoDropdown({
        name: "mode",
        displayNameKey: "Format_ContextMode",
        value: "none"
    });

    public pack = new formattingSettings.AutoDropdown({
        name: "pack",
        displayNameKey: "Format_ContextPack",
        value: "worldCountries"
    });

    public worldDetail = new formattingSettings.AutoDropdown({
        name: "worldDetail",
        displayNameKey: "Format_WorldDetail",
        value: "110m"
    });

    public packKeyMode = new formattingSettings.AutoDropdown({
        name: "packKeyMode",
        displayNameKey: "Format_PackKeyMode",
        value: "auto"
    });

    public svgFeatureThreshold = new formattingSettings.NumUpDown({
        name: "svgFeatureThreshold",
        displayNameKey: "Format_SvgFeatureThreshold",
        value: LIMITS.maxSvgContextFeatures,
        options: numberOptions(1, LIMITS.maxContextFeatures)
    });

    public svgVertexThreshold = new formattingSettings.NumUpDown({
        name: "svgVertexThreshold",
        displayNameKey: "Format_SvgVertexThreshold",
        value: LIMITS.maxSvgContextVertices,
        options: numberOptions(100, LIMITS.maxVerticesPerScene)
    });

    public pointSize = new formattingSettings.NumUpDown({
        name: "pointSize",
        displayNameKey: "Format_PointSize",
        value: 6,
        options: numberOptions(2, 24)
    });

    public fillColor = new formattingSettings.ColorPicker({
        name: "fillColor",
        displayNameKey: "Format_ContextFill",
        value: { value: "#D2D0CE" }
    });

    public strokeColor = new formattingSettings.ColorPicker({
        name: "strokeColor",
        displayNameKey: "Format_ContextStroke",
        value: { value: "#605E5C" }
    });

    public selectedColor = new formattingSettings.ColorPicker({
        name: "selectedColor",
        displayNameKey: "Format_ContextSelected",
        value: { value: "#118DFF" }
    });

    public maxGeometryCharacters = new formattingSettings.NumUpDown({
        name: "maxGeometryCharacters",
        displayNameKey: "Format_MaxGeometryCharacters",
        value: LIMITS.maxGeometryCharacters,
        options: numberOptions(1000, LIMITS.maxGeometryCharacters)
    });

    public maxSceneVertices = new formattingSettings.NumUpDown({
        name: "maxSceneVertices",
        displayNameKey: "Format_MaxSceneVertices",
        value: LIMITS.maxVerticesPerScene,
        options: numberOptions(1000, LIMITS.maxVerticesPerScene)
    });

    public override slices = [
        this.mode,
        this.pack,
        this.worldDetail,
        this.packKeyMode,
        this.svgFeatureThreshold,
        this.svgVertexThreshold,
        this.pointSize,
        this.fillColor,
        this.strokeColor,
        this.selectedColor,
        this.maxGeometryCharacters,
        this.maxSceneVertices
    ];
}

export class NavigationCard extends Card {
    public override name = "navigation";
    public override displayNameKey = "Format_Navigation_Card";

    public enabled = new formattingSettings.ToggleSwitch({
        name: "enabled",
        displayNameKey: "Format_NavigationEnabled",
        value: false
    });

    public minZoom = new formattingSettings.NumUpDown({
        name: "minZoom",
        displayNameKey: "Format_MinZoom",
        value: 1,
        options: numberOptions(1, 8)
    });

    public maxZoom = new formattingSettings.NumUpDown({
        name: "maxZoom",
        displayNameKey: "Format_MaxZoom",
        value: 8,
        options: numberOptions(1, 16)
    });

    public wheelSensitivity = new formattingSettings.NumUpDown({
        name: "wheelSensitivity",
        displayNameKey: "Format_WheelSensitivity",
        value: 1,
        options: numberOptions(0.25, 4)
    });

    public showCenterProbe = new formattingSettings.ToggleSwitch({
        name: "showCenterProbe",
        displayNameKey: "Format_ShowCenterProbe",
        value: true
    });

    public showResetControl = new formattingSettings.ToggleSwitch({
        name: "showResetControl",
        displayNameKey: "Format_ShowResetControl",
        value: true
    });

    public showGestureHelp = new formattingSettings.ToggleSwitch({
        name: "showGestureHelp",
        displayNameKey: "Format_ShowGestureHelp",
        value: true
    });

    public override slices = [
        this.enabled,
        this.minZoom,
        this.maxZoom,
        this.wheelSensitivity,
        this.showCenterProbe,
        this.showResetControl,
        this.showGestureHelp
    ];
}

export class LoadingCard extends Card {
    public override name = "loading";
    public override displayNameKey = "Format_Loading_Card";

    public strategy = new formattingSettings.AutoDropdown({
        name: "strategy",
        displayNameKey: "Format_LoadingStrategy",
        value: "auto"
    });

    public override slices = [this.strategy];
}

export class InteractionCard extends Card {
    public override name = "interaction";
    public override displayNameKey = "Format_Interaction_Card";

    public mode = new formattingSettings.AutoDropdown({
        name: "mode",
        displayNameKey: "Format_InteractionMode",
        value: "reportSelection"
    });

    public override slices = [this.mode];
}

export class ProfilesCard extends Card {
    public override name = "profiles";
    public override displayNameKey = "Format_Profiles_Card";

    public barThickness = new formattingSettings.NumUpDown({
        name: "barThickness",
        displayNameKey: "Format_BarThickness",
        value: 14,
        options: numberOptions(1, 64)
    });

    public showValueLabels = new formattingSettings.ToggleSwitch({
        name: "showValueLabels",
        displayNameKey: "Format_ShowValueLabels",
        value: false
    });

    public showBandLabels = new formattingSettings.ToggleSwitch({
        name: "showBandLabels",
        displayNameKey: "Format_ShowBandLabels",
        value: true
    });

    public showAxis = new formattingSettings.ToggleSwitch({
        name: "showAxis",
        displayNameKey: "Format_ShowAxis",
        value: true
    });

    public fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayNameKey: "Format_FontSize",
        value: 10,
        options: numberOptions(6, 24)
    });

    public labelColor = new formattingSettings.ColorPicker({
        name: "labelColor",
        displayNameKey: "Format_LabelColor",
        value: { value: "#252423" }
    });

    public override slices = [
        this.barThickness,
        this.showValueLabels,
        this.showBandLabels,
        this.showAxis,
        this.fontSize,
        this.labelColor
    ];
}

export class SeriesCard extends Card {
    public override name = "series";
    public override displayNameKey = "Format_Series_Card";

    public primaryColor = new formattingSettings.ColorPicker({
        name: "primaryColor",
        displayNameKey: "Format_PrimaryColor",
        value: { value: "#118DFF" }
    });

    public secondaryColor = new formattingSettings.ColorPicker({
        name: "secondaryColor",
        displayNameKey: "Format_SecondaryColor",
        value: { value: "#E66C37" }
    });

    public showLegend = new formattingSettings.ToggleSwitch({
        name: "showLegend",
        displayNameKey: "Format_ShowLegend",
        value: true
    });

    public usePatterns = new formattingSettings.ToggleSwitch({
        name: "usePatterns",
        displayNameKey: "Format_UsePatterns",
        value: true
    });

    public override slices = [this.primaryColor, this.secondaryColor, this.showLegend, this.usePatterns];
}

export class PeriodCard extends Card {
    public override name = "period";
    public override displayNameKey = "Format_Period_Card";

    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayNameKey: "Format_ShowPeriod",
        value: true
    });

    public position = new formattingSettings.AutoDropdown({
        name: "position",
        displayNameKey: "Format_PeriodPosition",
        value: "bottom"
    });

    public override topLevelSlice = this.show;
    public override slices = [this.position];
}

export class HeaderCard extends Card {
    public override name = "header";
    public override displayNameKey = "Format_Header_Card";

    public show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayNameKey: "Format_ShowHeader",
        value: true
    });

    public showEntityKey = new formattingSettings.ToggleSwitch({
        name: "showEntityKey",
        displayNameKey: "Format_ShowEntityKey",
        value: false
    });

    public showContextValue = new formattingSettings.ToggleSwitch({
        name: "showContextValue",
        displayNameKey: "Format_ShowContextValue",
        value: true
    });

    public fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayNameKey: "Format_HeaderFontSize",
        value: 12,
        options: numberOptions(8, 28)
    });

    public override topLevelSlice = this.show;
    public override slices = [this.showEntityKey, this.showContextValue, this.fontSize];
}

export class DiagnosticsCard extends Card {
    public override name = "diagnostics";
    public override displayNameKey = "Format_Diagnostics_Card";

    public showDiagnostics = new formattingSettings.ToggleSwitch({
        name: "showDiagnostics",
        displayNameKey: "Format_ShowDiagnostics",
        value: true
    });

    public showCounts = new formattingSettings.ToggleSwitch({
        name: "showCounts",
        displayNameKey: "Format_ShowCounts",
        value: false
    });

    public override slices = [this.showDiagnostics, this.showCounts];
}

export class AccessibilityCard extends Card {
    public override name = "accessibility";
    public override displayNameKey = "Format_Accessibility_Card";

    public showTable = new formattingSettings.AutoDropdown({
        name: "showTable",
        displayNameKey: "Format_ShowTable",
        value: "screenReader"
    });

    public reducedMotion = new formattingSettings.ToggleSwitch({
        name: "reducedMotion",
        displayNameKey: "Format_ReducedMotion",
        value: false
    });

    public override slices = [this.showTable, this.reducedMotion];
}

export class ProfileLensFormattingModel extends Model {
    public data = new DataCard();
    public layout = new LayoutCard();
    public context = new ContextCard();
    public navigation = new NavigationCard();
    public loading = new LoadingCard();
    public interaction = new InteractionCard();
    public profiles = new ProfilesCard();
    public series = new SeriesCard();
    public period = new PeriodCard();
    public header = new HeaderCard();
    public diagnostics = new DiagnosticsCard();
    public accessibility = new AccessibilityCard();

    public override cards = [
        this.data,
        this.layout,
        this.context,
        this.navigation,
        this.loading,
        this.interaction,
        this.profiles,
        this.series,
        this.period,
        this.header,
        this.diagnostics,
        this.accessibility
    ];
}

export interface ResolvedSettings {
    readonly normalization: NormalizationMode;
    readonly percentScale: PercentScale;
    readonly blankPolicy: BlankPolicy;
    readonly maxProfiles: number;
    readonly maxSeries: number;
    readonly arrangement: Arrangement;
    readonly contextLayout: ContextLayoutMode;
    readonly contextMode: ContextMode;
    readonly contextPack: "worldCountries" | "usStates" | "usCounties";
    readonly worldDetail: "110m" | "50m";
    readonly packKeyMode: "auto" | "canonical" | "isoAlpha3CaseFold" | "geoid2" | "geoid5";
    readonly svgFeatureThreshold: number;
    readonly svgVertexThreshold: number;
    readonly contextPointSize: number;
    readonly contextFillColor: string;
    readonly contextStrokeColor: string;
    readonly contextSelectedColor: string;
    readonly maxGeometryCharacters: number;
    readonly maxSceneVertices: number;
    readonly navigationEnabled: boolean;
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly wheelSensitivity: number;
    readonly showCenterProbe: boolean;
    readonly showResetControl: boolean;
    readonly showGestureHelp: boolean;
    readonly detailStrategy: Exclude<DetailStrategyId, "matrixExpand">;
    readonly interactionMode: "localOnly" | "reportSelection";
    readonly armRotation: number;
    readonly bandGap: number;
    readonly showEntityList: boolean;
    readonly direction: TextDirection;
    readonly barThickness: number;
    readonly showValueLabels: boolean;
    readonly showBandLabels: boolean;
    readonly showAxis: boolean;
    readonly fontSize: number;
    readonly labelColor: string;
    readonly primaryColor: string;
    readonly secondaryColor: string;
    readonly showLegend: boolean;
    readonly usePatterns: boolean;
    readonly showPeriod: boolean;
    readonly periodPosition: "top" | "bottom";
    readonly showHeader: boolean;
    readonly showEntityKey: boolean;
    readonly showContextValue: boolean;
    readonly headerFontSize: number;
    readonly showDiagnostics: boolean;
    readonly showCounts: boolean;
    readonly tableVisibility: TableVisibility;
    readonly reducedMotion: boolean;
}

const NORMALIZATION_MODES: readonly NormalizationMode[] = [
    "raw",
    "shareOfProfile",
    "shareWithinSeries",
    "indexToMaximum",
    "alreadyPercent"
];

export function resolveSettings(model: ProfileLensFormattingModel): ResolvedSettings {
    const minZoom = clamp(model.navigation.minZoom.value, 1, 8);
    const maxZoom = Math.max(minZoom, clamp(model.navigation.maxZoom.value, 1, 16));
    return {
        normalization: enumValue(model.data.normalization.value, NORMALIZATION_MODES, "raw"),
        percentScale: enumValue(model.data.percentScale.value, ["fraction", "percent"], "fraction"),
        blankPolicy: enumValue(model.data.blankPolicy.value, ["missing", "zero"], "missing"),
        maxProfiles: clamp(model.data.maxProfiles.value, 1, LIMITS.maxProfiles),
        maxSeries: clamp(model.data.maxSeries.value, 1, LIMITS.maxSeries),
        arrangement: enumValue(model.layout.arrangement.value, ["auto", "radial", "stacked"], "auto"),
        contextLayout: enumValue(
            model.layout.contextLayout.value,
            ["split", "focusLens", "locatorInset", "profileOnly"],
            "split"
        ),
        contextMode: enumValue(
            model.context.mode.value,
            ["none", "points", "boundGeometry", "grid", "hex", "builtInPack"],
            "none"
        ),
        contextPack: enumValue(
            model.context.pack.value,
            ["worldCountries", "usStates", "usCounties"],
            "worldCountries"
        ),
        worldDetail: enumValue(model.context.worldDetail.value, ["110m", "50m"], "110m"),
        packKeyMode: enumValue(
            model.context.packKeyMode.value,
            ["auto", "canonical", "isoAlpha3CaseFold", "geoid2", "geoid5"],
            "auto"
        ),
        svgFeatureThreshold: clamp(
            model.context.svgFeatureThreshold.value,
            1,
            LIMITS.maxContextFeatures
        ),
        svgVertexThreshold: clamp(
            model.context.svgVertexThreshold.value,
            100,
            LIMITS.maxVerticesPerScene
        ),
        contextPointSize: clamp(model.context.pointSize.value, 2, 24),
        contextFillColor: model.context.fillColor.value.value,
        contextStrokeColor: model.context.strokeColor.value.value,
        contextSelectedColor: model.context.selectedColor.value.value,
        maxGeometryCharacters: clamp(
            model.context.maxGeometryCharacters.value,
            1000,
            LIMITS.maxGeometryCharacters
        ),
        maxSceneVertices: clamp(
            model.context.maxSceneVertices.value,
            1000,
            LIMITS.maxVerticesPerScene
        ),
        navigationEnabled: model.navigation.enabled.value,
        minZoom,
        maxZoom,
        wheelSensitivity: clamp(model.navigation.wheelSensitivity.value, 0.25, 4),
        showCenterProbe: model.navigation.showCenterProbe.value,
        showResetControl: model.navigation.showResetControl.value,
        showGestureHelp: model.navigation.showGestureHelp.value,
        detailStrategy: enumValue(
            model.loading.strategy.value,
            ["auto", "eager", "segmented", "external"],
            "auto"
        ),
        interactionMode: enumValue(
            model.interaction.mode.value,
            ["localOnly", "reportSelection"],
            "reportSelection"
        ),
        armRotation: clamp(model.layout.armRotation.value, 0, 359),
        bandGap: clamp(model.layout.bandGap.value, 0, 12),
        showEntityList: model.layout.showEntityList.value,
        direction: enumValue(model.layout.direction.value, ["auto", "ltr", "rtl"], "auto"),
        barThickness: clamp(model.profiles.barThickness.value, 1, 64),
        showValueLabels: model.profiles.showValueLabels.value,
        showBandLabels: model.profiles.showBandLabels.value,
        showAxis: model.profiles.showAxis.value,
        fontSize: clamp(model.profiles.fontSize.value, 6, 24),
        labelColor: model.profiles.labelColor.value.value,
        primaryColor: model.series.primaryColor.value.value,
        secondaryColor: model.series.secondaryColor.value.value,
        showLegend: model.series.showLegend.value,
        usePatterns: model.series.usePatterns.value,
        showPeriod: model.period.show.value,
        periodPosition: enumValue(model.period.position.value, ["top", "bottom"], "bottom"),
        showHeader: model.header.show.value,
        showEntityKey: model.header.showEntityKey.value,
        showContextValue: model.header.showContextValue.value,
        headerFontSize: clamp(model.header.fontSize.value, 8, 28),
        showDiagnostics: model.diagnostics.showDiagnostics.value,
        showCounts: model.diagnostics.showCounts.value,
        tableVisibility: enumValue(
            model.accessibility.showTable.value,
            ["screenReader", "visible"],
            "screenReader"
        ),
        reducedMotion: model.accessibility.reducedMotion.value
    };
}

export function defaultSettings(): ResolvedSettings {
    return resolveSettings(new ProfileLensFormattingModel());
}

function enumValue<T extends string>(
    value: powerbi.EnumMemberValue,
    allowed: readonly T[],
    fallback: T
): T {
    const candidate = typeof value === "string" ? value : String(value ?? "");
    return allowed.includes(candidate as T) ? (candidate as T) : fallback;
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}
