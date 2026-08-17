import powerbi from "powerbi-visuals-api";
import { ResolvedSettings } from "../formatting";

type IColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;

export interface Theme {
    readonly isHighContrast: boolean;
    readonly foreground: string;
    readonly background: string;
    readonly foregroundSelected: string;
    readonly seriesColors: readonly [string, string];
    readonly labelColor: string;
    readonly gridColor: string;
    readonly missingColor: string;
    readonly usePatterns: boolean;
    readonly focusOutline: string;
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
            foreground,
            background,
            foregroundSelected: selected,
            seriesColors: [foreground, background],
            labelColor: foreground,
            gridColor: foreground,
            missingColor: background,
            usePatterns: true,
            focusOutline: foreground
        };
    }

    return {
        isHighContrast: false,
        foreground: "#252423",
        background: "#FFFFFF",
        foregroundSelected: "#000000",
        seriesColors: [settings.primaryColor, settings.secondaryColor],
        labelColor: settings.labelColor,
        gridColor: "#C8C6C4",
        missingColor: "#F3F2F1",
        usePatterns: settings.usePatterns,
        focusOutline: "#000000"
    };
}

export function seriesColor(theme: Theme, seriesIndex: number): string {
    const index = seriesIndex <= 0 ? 0 : 1;
    return theme.seriesColors[index] ?? theme.seriesColors[0];
}
