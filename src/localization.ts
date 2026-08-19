import powerbi from "powerbi-visuals-api";

type ILocalizationManager = powerbi.extensibility.ILocalizationManager;

/**
 * Every user visible string is resource keyed. The English defaults below are the fallback used
 * when the host does not provide a localization manager, for example in unit tests.
 */
export const DEFAULT_STRINGS = {
    Visual_Name: "Atlyn Profile Lens",
    Landing_Title: "Profile Lens",
    Landing_Subtitle: "Compare up to six report measures across ordered bands.",
    Landing_Step_Entity: "1. Add an entity field to Entity > Period > Band.",
    Landing_Step_Period: "2. Optionally add a period field as the second hierarchy field.",
    Landing_Step_Band: "3. Add the ordered band field as the last hierarchy field.",
    Landing_Step_Profile: "4. Add one to six numeric measures to Profile measures.",
    Landing_Step_Optional: "5. Optionally add Series, Tooltips, or context fields.",
    Landing_Note_ProfileOnly: "Context is optional. Built-in packs are offline cartographic resources; the visual makes no external requests.",
    Landing_Note_DataSource: "All analytical values come from fields you bind. Packs contain geometry, exact keys, names, source status, centroids, adjacency, and attribution only.",
    Landing_Note_PackKeys: "Built-in keys are exact text: world USA or NE:KOS; state 06; county 06037. Names, numeric padding, trimming, and fuzzy matching are not supported.",
    Landing_Note_PackPolicy: "World boundaries follow Natural Earth 5.1.1 de facto source policy. Census 2025 DC and territories are included through explicit cartographic insets.",
    Status_Rendering: "Rendering",
    Status_Ready: "Showing {0} bands across {1} profiles for {2}.",
    Status_Empty: "No data to display yet.",
    Status_Partial: "Partial data is displayed while more segments load.",
    Status_Failed: "The visual could not render this data view.",
    Header_Period: "Period",
    Header_ContextValue: "Context value",
    EntityList_Label: "Entities",
    EntityList_Empty: "No entities in the current filter context.",
    Context_Label: "Entity context",
    Navigation_Reset: "Reset view",
    Navigation_ProbeDescription: "The fixed center probe resolves the Context feature beneath it and updates the local profile while the viewport moves.",
    Navigation_GestureHelp: "Drag to pan. Scroll or pinch to zoom. Use Shift plus Arrow to pan, plus or minus to zoom, and Home to reset.",
    Period_Label: "Period",
    Legend_Label: "Series",
    Legend_SingleSeries: "All values",
    Table_Caption: "Profile values for {0}{1}",
    Table_PeriodSuffix: ", period {0}",
    Table_Band: "Band",
    Table_Raw: "raw",
    Table_Displayed: "displayed",
    Table_Missing: "missing",
    Table_NonNumericUnsupported: "non-numeric value unsupported",
    Table_NonFiniteUnsupported: "non-finite value {0} unsupported",
    Table_NegativeUnsupported: "negative value unsupported, raw {0}",
    Table_ZeroDenominator: "no denominator, raw {0}",
    Tooltip_Entity: "Entity",
    Tooltip_Period: "Period",
    Tooltip_Band: "Band",
    Tooltip_Series: "Series",
    Tooltip_Profile: "Profile",
    Tooltip_Raw: "Raw value",
    Tooltip_Displayed: "Displayed value",
    Aria_Chart: "Profile chart",
    Aria_Segment: "{0}, band {1}, series {2}, {3}",
    Aria_MissingValue: "no value",
    Aria_NonNumericUnsupported: "non-numeric value unsupported",
    Aria_NonFiniteUnsupported: "non-finite value {0} unsupported",
    Aria_NegativeUnsupported: "negative value {0} unsupported",
    Aria_ZeroDenominator: "raw value {0}, no normalization denominator",
    Context_DataState: "Data state",
    Context_DataAvailable: "Profile data available",
    Context_NoData: "No data in current report context",
    Context_Unloaded: "Profile detail is not loaded in the current DataView",
    Context_NoFeature: "No Context feature at the center probe",
    Context_Fallback: "Showing configured fallback Entity",
    Context_FallbackInvalid: "The configured fallback Entity key does not resolve to one unique loaded bound text Entity.",
    Context_SelectionRejected: "Power BI rejected the selection. Local focus is unchanged.",
    Context_AnnouncementLoaded: "Probe: {0}. Profile data available.",
    Context_AnnouncementNoData: "Probe: {0}. No data in current report context.",
    Context_AnnouncementUnloaded: "Probe: {0}. Profile detail is not loaded in the current DataView.",
    Context_AnnouncementNoFeature: "Probe: no Context feature.",
    Context_AnnouncementFallback: "Probe: no Context feature. Showing configured fallback Entity {0}.",
    Context_Coverage: "{0} loaded, {1} matched, {2} unloaded, {3} no-data backdrop features.",
    Diagnostic_NeedsEntity: "Add an entity field to the hierarchy well.",
    Diagnostic_NeedsBand: "Add an ordered band field as the last hierarchy field.",
    Diagnostic_NeedsProfile: "Add at least one numeric measure to Profile measures.",
    Diagnostic_HierarchyDepthUnsupported: "The hierarchy well accepts at most three fields; received {0}.",
    Diagnostic_ProfilesOverLimit: "Received {0} profile measures and kept {1}. Remove measures to show them all.",
    Diagnostic_SeriesOverLimit: "Received {0} series values and rendered {1}. Filter the series field to two values.",
    Diagnostic_EntitiesOverLimit: "Received {0} entities and kept {1}.",
    Diagnostic_PeriodsOverLimit: "Received {0} periods and kept {1}.",
    Diagnostic_BandsOverLimit: "Received {0} bands and kept {1}.",
    Diagnostic_TooltipFieldsOverLimit: "Received {0} tooltip fields and kept {1}.",
    Diagnostic_CellsOverLimit: "Received {0} values and kept {1}.",
    Diagnostic_DuplicateCells: "Rejected {0} duplicate entity, period, band and series cells.",
    Diagnostic_BlankValues: "{0} values are blank and are drawn as missing.",
    Diagnostic_NonNumericValues: "Rejected {0} non numeric values.",
    Diagnostic_NonFiniteValues: "Rejected {0} infinite or undefined values.",
    Diagnostic_NegativeProfileValues: "Rejected {0} negative profile values. Profile measures must be zero or greater.",
    Diagnostic_ZeroDenominator: "{0} values have a zero or negative denominator and cannot be normalized.",
    Diagnostic_PartialData: "Partial data: {0} segments loaded, {1} values retained.",
    Diagnostic_SegmentLimitReached: "Stopped after {0} segments, the configured maximum of {1}.",
    Diagnostic_HighlightActive: "Cross highlighting is active; unhighlighted values are dimmed.",
    Diagnostic_InteractionsDisabled: "Report interactions are disabled for this view.",
    Diagnostic_ExtensionRolesProfileOnly: "Context fields are bound: {0}. Choose a compatible Context provider to render them.",
    Diagnostic_InvalidCoordinates: "Rejected {0} coordinate values outside the valid latitude or longitude range.",
    Diagnostic_ConflictingCoordinates: "Rejected {0} conflicting coordinates for one entity.",
    Diagnostic_IncompleteCoordinates: "{0} entities have only one of latitude and longitude.",
    Diagnostic_OversizedGeometry: "Rejected {0} geometry strings above the configured character limit.",
    Diagnostic_EmptyGeometry: "Rejected {0} empty geometry strings.",
    Diagnostic_NonFiniteContextValue: "Rejected {0} non numeric context values.",
    Diagnostic_GeometryUpdateBudgetExceeded: "Rejected geometry after the 2,000,000-character visual safety budget for one update was reached.",
    Diagnostic_GeometryParseRejected: "Rejected {0} geometry values that do not match the strict supported GeoJSON or WKT grammar.",
    Diagnostic_GeometryFeatureLimit: "Received {0} context features and retained {1}.",
    Diagnostic_GeometryRingLimit: "Rejected {0} geometry values that exceed the ring limit.",
    Diagnostic_GeometryVertexLimit: "Rejected {0} geometry values that exceed a vertex limit.",
    Diagnostic_ContextProviderUnavailable: "The selected Context provider has no compatible bound input.",
    Diagnostic_ContextScenePartial: "Context is partial because {0} features were rejected.",
    Diagnostic_MalformedPackKey: "Rejected malformed pack keys. Use exact text such as USA, NE:KOS, 06, or 06037.",
    Diagnostic_UnsupportedPackKey: "Rejected keys unsupported by the selected pack key mode.",
    Diagnostic_UnmatchedPackKey: "No exact feature matched these keys in the selected pack.",
    Diagnostic_DuplicatePackKey: "Rejected duplicate normalized pack keys to avoid ambiguous selection identities.",
    Diagnostic_PackArtifactInvalid: "The selected built-in context pack is unavailable or invalid.",
    Diagnostic_FallbackEntityInvalid: "The configured fallback Entity key does not resolve to one unique loaded bound text Entity.",
    Diagnostic_HostSelectionRejected: "Power BI rejected the selection. Local focus is unchanged.",
    Format_Data_Card: "Data",
    Format_Layout_Card: "Layout",
    Format_Context_Card: "Context",
    Format_Navigation_Card: "Navigation",
    Format_NavigationEnabled: "Viewport navigation",
    Format_NavigationEnabled_Description: "Automatic enables the fixed-center viewport lens for interactive multi-feature Context scenes. Legacy false and true values remain Off and On.",
    Format_NavigationMode_Auto: "Automatic",
    Format_NavigationMode_On: "On",
    Format_NavigationMode_Off: "Off",
    Format_MinZoom: "Minimum zoom",
    Format_MaxZoom: "Maximum zoom",
    Format_WheelSensitivity: "Wheel sensitivity",
    Format_ShowCenterProbe: "Show center probe",
    Format_ShowResetControl: "Show reset control",
    Format_ShowGestureHelp: "Show gesture help",
    Format_ShowNoDataBackdrop: "Show no-data backdrop",
    Format_ShowNoDataBackdrop_Description: "Hide unbound base paint while retaining complete probe, navigation, picking, and semantic geometry.",
    Format_ProbeAnnouncementVerbosity: "Probe announcement detail",
    Format_ProbeAnnouncementVerbosity_Description: "Choose concise state changes or detailed source and data-coverage announcements.",
    Format_ProbeAnnouncementVerbosity_Concise: "Concise",
    Format_ProbeAnnouncementVerbosity_Detailed: "Detailed",
    Format_FallbackEntityKey: "Fallback Entity key (exact text)",
    Format_FallbackEntityKey_Description: "Exact raw text of one loaded bound Entity to show only when the probe is over no Context feature.",
    Format_Loading_Card: "Detail loading",
    Format_Interaction_Card: "Interaction",
    Format_Profiles_Card: "Profiles",
    Format_Series_Card: "Series",
    Format_Period_Card: "Period",
    Format_Header_Card: "Header",
    Format_Diagnostics_Card: "Diagnostics",
    Format_Accessibility_Card: "Accessibility",
    Format_ContextPack: "Built-in pack",
    Format_WorldDetail: "World detail",
    Format_PackKeyMode: "Pack key mode"
} as const;

export type ResourceKey = keyof typeof DEFAULT_STRINGS;

const RTL_LANGUAGES = ["ar", "arc", "dv", "fa", "he", "ku", "ps", "sd", "ug", "ur", "yi"];

export class Localization {
    private readonly manager: ILocalizationManager | undefined;
    private readonly locale: string;

    public constructor(manager?: ILocalizationManager, locale?: string) {
        this.manager = manager;
        this.locale = locale && locale.length > 0 ? locale : "en-US";
    }

    public get currentLocale(): string {
        return this.locale;
    }

    public get isRightToLeft(): boolean {
        const language = this.locale.toLowerCase().split(/[-_]/)[0];
        return RTL_LANGUAGES.includes(language);
    }

    public get(key: ResourceKey): string {
        const fallback = DEFAULT_STRINGS[key];
        if (!this.manager) {
            return fallback;
        }
        const localized = this.manager.getDisplayName(key);
        return typeof localized === "string" && localized.length > 0 ? localized : fallback;
    }

    /** Substitutes positional placeholders such as {0} without any templating engine. */
    public format(key: ResourceKey, ...values: readonly (string | number)[]): string {
        const template = this.get(key);
        return template.replace(/\{(\d+)\}/g, (match, indexText: string) => {
            const index = Number(indexText);
            const value = values[index];
            return value === undefined ? match : String(value);
        });
    }

    public formatNumber(value: number, maximumFractionDigits = 2): string {
        return new Intl.NumberFormat(this.locale, { maximumFractionDigits }).format(value);
    }

    public formatPercent(value: number, maximumFractionDigits = 1): string {
        return new Intl.NumberFormat(this.locale, {
            style: "percent",
            maximumFractionDigits
        }).format(value);
    }
}
