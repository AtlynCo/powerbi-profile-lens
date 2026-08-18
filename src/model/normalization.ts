import {
    BlankPolicy,
    IMPLICIT_INDEX,
    NormalizationMode,
    PercentScale,
    ProfileCell
} from "./contract";

export interface NormalizationSettings {
    readonly mode: NormalizationMode;
    readonly percentScale: PercentScale;
    readonly blankPolicy: BlankPolicy;
}

export type NormalizationState = "value" | "missing" | "negativeValue" | "zeroDenominator";

export interface NormalizedCell {
    readonly profileIndex: number;
    readonly seriesIndex: number;
    readonly bandIndex: number;
    readonly raw: number | null;
    /** Value used for rendering, expressed in the profile's display unit. */
    readonly display: number | null;
    readonly denominator: number | null;
    readonly state: NormalizationState;
    readonly highlighted: boolean;
    readonly dimmed: boolean;
}

export interface NormalizedProfile {
    readonly profileIndex: number;
    readonly axisMaximum: number;
    readonly cells: readonly NormalizedCell[];
    readonly zeroDenominator: boolean;
}

export interface NormalizedFrame {
    readonly mode: NormalizationMode;
    readonly isProportional: boolean;
    readonly profiles: readonly NormalizedProfile[];
    readonly zeroDenominatorCount: number;
    readonly negativeValueCount: number;
    readonly missingCount: number;
}

export interface FrameSelector {
    readonly entityIndex: number;
    readonly periodIndex: number;
}

const PROPORTIONAL_MODES: readonly NormalizationMode[] = [
    "shareOfProfile",
    "shareWithinSeries",
    "indexToMaximum",
    "alreadyPercent"
];

export function isProportionalMode(mode: NormalizationMode): boolean {
    return PROPORTIONAL_MODES.includes(mode);
}

export function selectFrameCells(
    cells: readonly ProfileCell[],
    selector: FrameSelector
): readonly ProfileCell[] {
    return cells.filter(
        (cell) => cell.entityIndex === selector.entityIndex && cell.periodIndex === selector.periodIndex
    );
}

/**
 * Normalizes one entity/period frame.
 *
 * Every mode is explicit. There is no heuristic auto-detection, and a zero or non-positive
 * denominator produces a missing mark plus a diagnostic rather than a plausible-looking value.
 */
export function normalizeFrame(
    frameCells: readonly ProfileCell[],
    profileIndexes: readonly number[],
    settings: NormalizationSettings,
    hasAnyHighlight: boolean
): NormalizedFrame {
    const profiles: NormalizedProfile[] = [];
    let zeroDenominatorCount = 0;
    let negativeValueCount = 0;
    let missingCount = 0;

    for (const profileIndex of profileIndexes) {
        const profileCells = frameCells.filter((cell) => cell.profileIndex === profileIndex);
        const resolved = profileCells.map((cell) => ({
            cell,
            value: resolveRaw(cell, settings.blankPolicy)
        }));

        const profileTotal = sumPositive(resolved.map((entry) => entry.value));
        const seriesTotals = new Map<number, number>();
        for (const entry of resolved) {
            const seriesIndex = entry.cell.seriesIndex;
            const current = seriesTotals.get(seriesIndex) ?? 0;
            seriesTotals.set(seriesIndex, current + positivePart(entry.value));
        }
        const profileMaximum = resolved.reduce(
            (maximum, entry) => Math.max(maximum, positivePart(entry.value)),
            0
        );

        const cells: NormalizedCell[] = [];
        let zeroDenominator = false;

        for (const entry of resolved) {
            const raw = entry.value;
            const highlighted = entry.cell.hasHighlight
                && entry.cell.highlight !== null
                && entry.cell.highlight !== 0;
            const dimmed = hasAnyHighlight && !highlighted;

            if (raw === null) {
                missingCount++;
                cells.push({
                    profileIndex,
                    seriesIndex: entry.cell.seriesIndex,
                    bandIndex: entry.cell.bandIndex,
                    raw: null,
                    display: null,
                    denominator: null,
                    state: "missing",
                    highlighted,
                    dimmed
                });
                continue;
            }

            if (raw < 0) {
                negativeValueCount++;
                cells.push({
                    profileIndex,
                    seriesIndex: entry.cell.seriesIndex,
                    bandIndex: entry.cell.bandIndex,
                    raw,
                    display: null,
                    denominator: null,
                    state: "negativeValue",
                    highlighted,
                    dimmed
                });
                continue;
            }

            const denominator = denominatorFor(
                settings.mode,
                profileTotal,
                seriesTotals.get(entry.cell.seriesIndex) ?? 0,
                profileMaximum
            );

            if (denominator !== null && denominator <= 0) {
                zeroDenominator = true;
                zeroDenominatorCount++;
                cells.push({
                    profileIndex,
                    seriesIndex: entry.cell.seriesIndex,
                    bandIndex: entry.cell.bandIndex,
                    raw,
                    display: null,
                    denominator,
                    state: "zeroDenominator",
                    highlighted,
                    dimmed
                });
                continue;
            }

            const display = computeDisplay(settings, raw, denominator);
            cells.push({
                profileIndex,
                seriesIndex: entry.cell.seriesIndex,
                bandIndex: entry.cell.bandIndex,
                raw,
                display,
                denominator,
                state: "value",
                highlighted,
                dimmed
            });
        }

        const axisMaximum = cells.reduce((maximum, cell) => {
            return cell.display === null ? maximum : Math.max(maximum, cell.display);
        }, 0);

        profiles.push({
            profileIndex,
            axisMaximum: axisMaximum > 0 ? axisMaximum : 1,
            cells,
            zeroDenominator
        });
    }

    return {
        mode: settings.mode,
        isProportional: isProportionalMode(settings.mode),
        profiles,
        zeroDenominatorCount,
        negativeValueCount,
        missingCount
    };
}

export function formatDisplayValue(
    value: number | null,
    mode: NormalizationMode,
    locale: string
): string {
    if (value === null) {
        return "";
    }
    if (isProportionalMode(mode)) {
        return new Intl.NumberFormat(locale, {
            style: "percent",
            maximumFractionDigits: 1
        }).format(value);
    }
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

function resolveRaw(cell: ProfileCell, blankPolicy: BlankPolicy): number | null {
    if (cell.state === "value" && cell.value !== null) {
        return cell.value;
    }
    if (cell.state === "missing" && blankPolicy === "zero") {
        return 0;
    }
    return null;
}

function denominatorFor(
    mode: NormalizationMode,
    profileTotal: number,
    seriesTotal: number,
    profileMaximum: number
): number | null {
    switch (mode) {
        case "raw":
        case "alreadyPercent":
            return null;
        case "shareOfProfile":
            return profileTotal;
        case "shareWithinSeries":
            return seriesTotal;
        case "indexToMaximum":
            return profileMaximum;
        default:
            return null;
    }
}

function computeDisplay(
    settings: NormalizationSettings,
    raw: number,
    denominator: number | null
): number {
    if (settings.mode === "raw") {
        return raw;
    }
    if (settings.mode === "alreadyPercent") {
        return settings.percentScale === "percent" ? raw / 100 : raw;
    }
    if (denominator === null || denominator === 0) {
        return 0;
    }
    return raw / denominator;
}

function sumPositive(values: readonly (number | null)[]): number {
    return values.reduce<number>((total, value) => total + positivePart(value), 0);
}

function positivePart(value: number | null): number {
    if (value === null || !Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return value;
}

export function seriesIndexesOf(cells: readonly ProfileCell[]): readonly number[] {
    const seen = new Set<number>();
    for (const cell of cells) {
        seen.add(cell.seriesIndex);
    }
    if (seen.size === 0) {
        return [IMPLICIT_INDEX];
    }
    return [...seen].sort((left, right) => left - right);
}
