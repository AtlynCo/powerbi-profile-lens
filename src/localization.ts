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
    Landing_Note_ProfileOnly: "This visual renders profiles only. It draws no map and makes no external requests.",
    Landing_Note_DataSource: "All values come from the fields you bind. No data is bundled with the visual.",
    Status_Rendering: "Rendering",
    Status_Ready: "Showing {0} bands across {1} profiles for {2}.",
    Status_Empty: "No data to display yet.",
    Status_Partial: "Partial data is displayed while more segments load.",
    Status_Failed: "The visual could not render this data view.",
    Header_Period: "Period",
    Header_ContextValue: "Context value",
    EntityList_Label: "Entities",
    EntityList_Empty: "No entities in the current filter context.",
    Period_Label: "Period",
    Legend_Label: "Series",
    Legend_SingleSeries: "All values",
    Table_Caption: "Profile values for {0}{1}",
    Table_PeriodSuffix: ", period {0}",
    Table_Band: "Band",
    Table_Raw: "raw",
    Table_Displayed: "displayed",
    Table_Missing: "missing",
    Table_ZeroDenominator: "no denominator",
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
    Diagnostic_ZeroDenominator: "{0} values have a zero or negative denominator and cannot be normalized.",
    Diagnostic_PartialData: "Partial data: {0} segments loaded, {1} values retained.",
    Diagnostic_SegmentLimitReached: "Stopped after {0} segments, the configured maximum of {1}.",
    Diagnostic_HighlightActive: "Cross highlighting is active; unhighlighted values are dimmed.",
    Diagnostic_InteractionsDisabled: "Report interactions are disabled for this view.",
    Diagnostic_ExtensionRolesProfileOnly: "This package is profile only. The bound fields ({0}) are validated and passed to extension consumers, but no map or geography is drawn here.",
    Diagnostic_InvalidCoordinates: "Rejected {0} coordinate values outside the valid latitude or longitude range.",
    Diagnostic_ConflictingCoordinates: "Rejected {0} conflicting coordinates for one entity.",
    Diagnostic_IncompleteCoordinates: "{0} entities have only one of latitude and longitude.",
    Diagnostic_OversizedGeometry: "Rejected {0} geometry strings longer than {1} characters.",
    Diagnostic_EmptyGeometry: "Rejected {0} empty geometry strings.",
    Diagnostic_NonFiniteContextValue: "Rejected {0} non numeric context values.",
    Format_Data_Card: "Data",
    Format_Layout_Card: "Layout",
    Format_Profiles_Card: "Profiles",
    Format_Series_Card: "Series",
    Format_Period_Card: "Period",
    Format_Header_Card: "Header",
    Format_Diagnostics_Card: "Diagnostics",
    Format_Accessibility_Card: "Accessibility"
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
