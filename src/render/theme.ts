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
    readonly labelColor: string;
    readonly gridColor: string;
    readonly missingColor: string;
    readonly usePatterns: boolean;
    readonly focusOutline: string;
    readonly cartography: {
        readonly ocean: string;
        readonly land: string;
        readonly water: string;
        readonly waterOutline: string;
        readonly river: string;
        readonly graticule: string;
        readonly coastline: string;
        readonly admin: string;
        readonly label: string;
        readonly labelHalo: string;
    };
}

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
            labelColor: foreground,
            gridColor: foreground,
            missingColor: background,
            usePatterns: true,
            focusOutline: foreground,
            cartography: {
                ocean: background,
                land: background,
                water: background,
                waterOutline: foreground,
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
    return {
        isHighContrast: false,
        isDark,
        foreground: "#252423",
        background,
        foregroundSelected: "#000000",
        seriesColors: [settings.primaryColor, settings.secondaryColor],
        labelColor: settings.labelColor,
        gridColor: "#C8C6C4",
        missingColor: "#F3F2F1",
        usePatterns: settings.usePatterns,
        focusOutline: isDark ? "#FFFFFF" : "#000000",
        cartography: isDark ? {
            ocean: "#17242B",
            land: "#29383D",
            water: "#1D3038",
            waterOutline: "#547582",
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
    const match = /^#([0-9a-f]{6})$/i.exec(color);
    if (!match) return 1;
    const channels = [0, 2, 4].map((offset) =>
        Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function seriesColor(theme: Theme, seriesIndex: number): string {
    const index = seriesIndex <= 0 ? 0 : 1;
    return theme.seriesColors[index] ?? theme.seriesColors[0];
}
