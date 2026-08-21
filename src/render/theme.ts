import powerbi from "powerbi-visuals-api";
import { ResolvedSettings } from "../formatting";

type IColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;

export interface Theme {
    readonly isHighContrast: boolean;
    readonly isDark: boolean;
    readonly foreground: string;
    readonly background: string;
    readonly foregroundSelected: string;
    readonly seriesColors: readonly [string, string];
    /**
     * Colours the bars are actually painted with.
     *
     * These carry a guaranteed relative-luminance separation, so the two series stay distinct in
     * greyscale and for every colour-vision deficiency. Hue alone never carries the difference.
     */
    readonly seriesFills: readonly [string, string];
    readonly seriesLuminanceSeparation: number;
    readonly labelColor: string;
    readonly gridColor: string;
    readonly axisColor: string;
    readonly missingColor: string;
    readonly usePatterns: boolean;
    readonly focusOutline: string;
    readonly lens: {
        readonly scrim: string;
        readonly scrimOpacity: number;
        readonly rim: string;
        readonly rimOpacity: number;
    };
    readonly cartography: {
        readonly ocean: string;
        readonly land: string;
        readonly water: string;
        readonly waterOutline: string;
        readonly waterOutlineWidth: number;
        readonly river: string;
        readonly graticule: string;
        readonly coastline: string;
        readonly admin: string;
        readonly label: string;
        readonly labelHalo: string;
    };
}

/** Smallest relative-luminance gap the two series fills are guaranteed to keep. */
export const MIN_SERIES_LUMINANCE_SEPARATION = 0.18;

/**
 * Resolves the palette actually used for drawing.
 *
 * In high contrast the host's foreground, background and selected colors replace the format pane
 * colors, and shape differentiation moves to patterns and outlines so nothing depends on hue alone.
 */
export function resolveTheme(
    colorPalette: IColorPalette | undefined,
    settings: ResolvedSettings
): Theme {
    const highContrast = Boolean(colorPalette?.isHighContrast);
    if (highContrast && colorPalette) {
        const foreground = colorPalette.foreground.value;
        const background = colorPalette.background.value;
        const selected = colorPalette.foregroundSelected.value;
        return {
            isHighContrast: true,
            isDark: false,
            foreground,
            background,
            foregroundSelected: selected,
            seriesColors: [foreground, background],
            seriesFills: [foreground, background],
            seriesLuminanceSeparation: Math.abs(
                relativeLuminance(foreground) - relativeLuminance(background)
            ),
            labelColor: foreground,
            gridColor: foreground,
            axisColor: foreground,
            missingColor: background,
            usePatterns: true,
            focusOutline: foreground,
            lens: {
                scrim: background,
                // High contrast never dims: the host owns the two colours, and washing one of them
                // out is exactly the failure the mode exists to prevent. The rim alone contains.
                scrimOpacity: 0,
                rim: foreground,
                rimOpacity: 1
            },
            cartography: {
                ocean: background,
                land: background,
                water: background,
                waterOutline: foreground,
                waterOutlineWidth: 1,
                river: foreground,
                graticule: foreground,
                coastline: foreground,
                admin: foreground,
                label: foreground,
                labelHalo: background
            }
        };
    }

    const background = colorPalette?.background.value ?? "#FFFFFF";
    const isDark = relativeLuminance(background) < 0.25;
    const seriesFills = separateSeriesFills(
        settings.primaryColor,
        settings.secondaryColor,
        isDark
    );
    return {
        isHighContrast: false,
        isDark,
        foreground: "#252423",
        background,
        foregroundSelected: "#000000",
        seriesColors: [settings.primaryColor, settings.secondaryColor],
        seriesFills,
        seriesLuminanceSeparation: Math.abs(
            relativeLuminance(seriesFills[0]) - relativeLuminance(seriesFills[1])
        ),
        labelColor: settings.labelColor,
        gridColor: "#C8C6C4",
        axisColor: isDark ? "#8A9BA1" : "#8A8886",
        missingColor: "#F3F2F1",
        usePatterns: settings.usePatterns,
        focusOutline: isDark ? "#FFFFFF" : "#000000",
        lens: {
            scrim: isDark ? "#0B1418" : "#FFFFFF",
            scrimOpacity: isDark ? 0.52 : 0.62,
            rim: isDark ? "#E7EEF1" : "#3B3A39",
            rimOpacity: 0.75
        },
        cartography: isDark ? {
            ocean: "#17242B",
            land: "#29383D",
            water: "#1D3038",
            waterOutline: "#547582",
            waterOutlineWidth: 0.35,
            river: "#547582",
            graticule: "rgba(190,210,216,0.24)",
            coastline: "#9AABB0",
            admin: "#687C82",
            label: "#F3F6F7",
            labelHalo: "#17242B"
        } : {
            ocean: "#DCE8EC",
            land: "#F1EFE8",
            water: "#C7DCE3",
            waterOutline: "#7FA9B8",
            waterOutlineWidth: 0.35,
            river: "#7FA9B8",
            graticule: "rgba(80,105,112,0.28)",
            coastline: "#6D7474",
            admin: "#9A9C98",
            label: "#303536",
            labelHalo: "#F7F5EF"
        }
    };
}

function relativeLuminance(color: string): number {
    const channels = parseColor(color);
    if (!channels) {
        return 1;
    }
    const linear = channels.map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function parseColor(color: string): [number, number, number] | null {
    const long = /^#([0-9a-f]{6})$/i.exec(color);
    if (long) {
        const hex = long[1];
        return [0, 2, 4].map((offset) =>
            Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
    }
    const short = /^#([0-9a-f]{3})$/i.exec(color);
    if (short) {
        const hex = short[1];
        return [0, 1, 2].map((offset) =>
            Number.parseInt(hex[offset].repeat(2), 16) / 255) as [number, number, number];
    }
    return null;
}

function toHex(channels: readonly [number, number, number]): string {
    const part = (value: number): string => {
        const byte = Math.round(Math.min(Math.max(value, 0), 1) * 255);
        return byte.toString(16).padStart(2, "0").toUpperCase();
    };
    return `#${part(channels[0])}${part(channels[1])}${part(channels[2])}`;
}

/** Moves a colour toward white (positive) or black (negative) by a fraction of the remaining gap. */
export function shiftLightness(color: string, amount: number): string {
    const channels = parseColor(color);
    if (!channels) {
        return color;
    }
    const factor = Math.min(Math.max(Math.abs(amount), 0), 1);
    const shifted = channels.map((value) =>
        amount >= 0 ? value + (1 - value) * factor : value * (1 - factor));
    return toHex(shifted as [number, number, number]);
}

/**
 * Guarantees the two series fills differ in lightness, not only in hue.
 *
 * The author's colours are honoured whenever they already separate. When they do not, the second
 * series is stepped away from the first until the gap is met, which is what keeps a two-series
 * profile readable in greyscale, under every colour-vision deficiency, and in print.
 */
export function separateSeriesFills(
    primary: string,
    secondary: string,
    isDark: boolean
): readonly [string, string] {
    const primaryLuminance = relativeLuminance(primary);
    let candidate = secondary;
    let separation = Math.abs(relativeLuminance(candidate) - primaryLuminance);
    if (separation >= MIN_SERIES_LUMINANCE_SEPARATION) {
        return [primary, candidate];
    }
    // Step away from the primary, toward whichever end of the range has room for it.
    const direction = primaryLuminance > 0.5 ? -1 : 1;
    for (const step of [0.18, 0.32, 0.46, 0.6, 0.74]) {
        candidate = shiftLightness(secondary, direction * step);
        separation = Math.abs(relativeLuminance(candidate) - primaryLuminance);
        if (separation >= MIN_SERIES_LUMINANCE_SEPARATION) {
            return [primary, candidate];
        }
    }
    return [primary, isDark ? "#F3F6F7" : "#1B1A19"];
}

export function seriesColor(theme: Theme, seriesIndex: number): string {
    const index = seriesIndex <= 0 ? 0 : 1;
    return theme.seriesColors[index] ?? theme.seriesColors[0];
}

/** Bar fill for a series slot, already luminance separated. */
export function seriesFill(theme: Theme, seriesIndex: number): string {
    const index = seriesIndex <= 0 ? 0 : 1;
    return theme.seriesFills[index] ?? theme.seriesFills[0];
}
