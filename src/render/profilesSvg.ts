import {
    ArmLayout,
    Point,
    ProfileLayout,
    bandSegment
} from "../layout/profileLayout";
import { TextMeasurer, estimateTextWidth, fitText, wrapText } from "../layout/textFit";
import { ResolvedSettings } from "../formatting";
import { Localization } from "../localization";
import { IMPLICIT_INDEX, ProfileDataModel } from "../model/contract";
import { NormalizedCell, NormalizedFrame, formatDisplayValue } from "../model/normalization";
import { Theme, seriesColor } from "./theme";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Copy for the designed no-data presentation.
 *
 * The message repeats the authoritative state text already shown in the header, the status line and
 * the accessible table, so the chart never contradicts them, and the guidance names the next action.
 */
export interface ProfileEmptyState {
    readonly message: string;
    readonly guidance: string;
}

export interface RenderInput {
    readonly model: ProfileDataModel;
    readonly frame: NormalizedFrame;
    readonly layout: ProfileLayout;
    readonly settings: ResolvedSettings;
    readonly theme: Theme;
    readonly localization: Localization;
    readonly entityIndex: number;
    readonly periodIndex: number;
    readonly interactive: boolean;
    readonly focusKey: string | null;
    readonly selectedKeys: ReadonlySet<string>;
    readonly measure?: TextMeasurer;
    readonly emptyState?: ProfileEmptyState | null;
}

export interface RenderedTarget {
    readonly key: string;
    readonly element: SVGGElement;
    readonly profileIndex: number;
    readonly bandIndex: number;
    readonly seriesIndex: number;
    readonly raw: number | null;
    readonly display: number | null;
}

export function targetKey(profileIndex: number, bandIndex: number, seriesIndex: number): string {
    return `p${profileIndex}|b${bandIndex}|s${seriesIndex}`;
}

/**
 * Draws the profile chart into the supplied SVG root and returns the interactive targets.
 *
 * The renderer only writes attributes and text nodes, never markup, and it returns targets so the
 * interaction layer can attach listeners without re-querying the DOM by selector.
 *
 * When the frame carries no cells there is nothing to measure, so the chart skeleton is suppressed
 * entirely and one bounded empty-state card is drawn instead. Painting an axis, band labels and
 * metric captions around zero bars is what makes a no-data probe read as broken rather than empty.
 */
export function renderProfiles(svg: SVGSVGElement, input: RenderInput): readonly RenderedTarget[] {
    const { layout, theme, settings, localization } = input;
    clear(svg);
    svg.setAttribute("width", String(Math.max(layout.chart.width, 0)));
    svg.setAttribute("height", String(Math.max(layout.chart.height, 0)));
    svg.setAttribute(
        "viewBox",
        `${layout.chart.x} ${layout.chart.y} ${Math.max(layout.chart.width, 0)} ${Math.max(layout.chart.height, 0)}`
    );
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", localization.get("Aria_Chart"));
    svg.setAttribute("focusable", "false");

    const measure = input.measure ?? estimateTextWidth;

    if (frameCellCount(input.frame) === 0) {
        svg.setAttribute("data-empty", "true");
        appendEmptyState(svg, input, measure);
        return [];
    }
    svg.removeAttribute("data-empty");

    if (theme.usePatterns) {
        svg.appendChild(buildPatternDefs(theme));
    }

    const chartLayer = element<SVGGElement>("g");
    chartLayer.setAttribute("class", "profile-lens-chart-layer");
    const labelLayer = element<SVGGElement>("g");
    labelLayer.setAttribute("class", "profile-lens-label-layer");
    labelLayer.setAttribute("aria-hidden", "true");
    svg.appendChild(chartLayer);
    svg.appendChild(labelLayer);

    const targets: RenderedTarget[] = [];
    const bandCount = Math.max(input.model.bands.length, 1);

    for (const arm of layout.arms) {
        const profile = input.frame.profiles.find((entry) => entry.profileIndex === arm.profileIndex);
        if (!profile) {
            continue;
        }
        const armGroup = element<SVGGElement>("g");
        armGroup.setAttribute("class", "profile-lens-arm");
        armGroup.setAttribute(
            "transform",
            `translate(${round(arm.origin.x)},${round(arm.origin.y)}) rotate(${round(-arm.angleDegrees)})`
        );
        chartLayer.appendChild(armGroup);

        if (layout.chrome.axis) {
            const axis = element<SVGLineElement>("line");
            axis.setAttribute("x1", String(round(arm.bandStart)));
            axis.setAttribute("y1", "0");
            axis.setAttribute("x2", String(round(arm.bandStart + arm.bandExtent)));
            axis.setAttribute("y2", "0");
            axis.setAttribute("stroke", theme.gridColor);
            axis.setAttribute("stroke-width", "1");
            armGroup.appendChild(axis);
        }

        for (const cell of profile.cells) {
            const seriesSlot = cell.seriesIndex === IMPLICIT_INDEX ? 0 : cell.seriesIndex;
            const magnitude = cell.display === null
                ? 0
                : Math.min(cell.display / profile.axisMaximum, 1);
            const geometry = bandSegment(
                arm,
                cell.bandIndex,
                bandCount,
                seriesSlot,
                magnitude
            );
            const key = targetKey(arm.profileIndex, cell.bandIndex, cell.seriesIndex);
            const group = element<SVGGElement>("g");
            group.setAttribute("class", "profile-lens-target");
            group.setAttribute("data-key", key);
            group.setAttribute("role", "button");
            group.setAttribute(
                "tabindex",
                input.interactive && input.focusKey === key ? "0" : "-1"
            );
            group.setAttribute("aria-label", describeCell(input, cell, arm.profileIndex));
            if (!input.interactive) {
                group.setAttribute("aria-disabled", "true");
            }
            if (input.selectedKeys.has(key)) {
                group.setAttribute("aria-pressed", "true");
            }

            const rect = element<SVGRectElement>("rect");
            const isMissing = cell.state !== "value" || cell.display === null;
            const height = isMissing ? Math.max(arm.valueExtent * 0.05, 2) : Math.max(geometry.height, 0);
            rect.setAttribute("x", String(round(geometry.x)));
            rect.setAttribute("y", String(round(isMissing ? -height : geometry.y)));
            rect.setAttribute("width", String(round(Math.max(geometry.width, 1))));
            rect.setAttribute("height", String(round(height)));
            rect.setAttribute("fill", isMissing ? theme.missingColor : fillFor(theme, seriesSlot));
            rect.setAttribute("stroke", theme.isHighContrast ? theme.foreground : "none");
            rect.setAttribute("stroke-width", theme.isHighContrast ? "1" : "0");
            if (isMissing) {
                rect.setAttribute("stroke", theme.gridColor);
                rect.setAttribute("stroke-width", "1");
                rect.setAttribute("stroke-dasharray", "2 2");
            }
            if (cell.dimmed) {
                rect.setAttribute("fill-opacity", "0.3");
            }
            if (input.selectedKeys.has(key)) {
                rect.setAttribute("stroke", theme.foregroundSelected);
                rect.setAttribute("stroke-width", "2");
            }
            group.appendChild(rect);
            armGroup.appendChild(group);

            targets.push({
                key,
                element: group,
                profileIndex: arm.profileIndex,
                bandIndex: cell.bandIndex,
                seriesIndex: cell.seriesIndex,
                raw: cell.raw,
                display: cell.display
            });

            if (layout.chrome.valueLabels && !isMissing) {
                const labelOffset = geometry.y < 0 ? geometry.y - 4 : geometry.y + geometry.height + 4;
                const anchor = rotate(
                    { x: geometry.x + geometry.width / 2, y: labelOffset },
                    arm.angleDegrees,
                    arm.origin
                );
                labelLayer.appendChild(
                    text(
                        formatDisplayValue(cell.display, input.frame.mode, localization.currentLocale),
                        anchor,
                        settings.fontSize - 1,
                        theme.labelColor,
                        "middle"
                    )
                );
            }
        }

        if (layout.chrome.bandLabels && arm.profileIndex === 0) {
            appendBandLabels(labelLayer, input, arm, bandCount, measure);
        }

        const profileRef = input.model.profiles[arm.profileIndex];
        if (profileRef && layout.chrome.bandLabels) {
            const label = fitText(
                profileRef.label,
                Math.max(layout.radius * 0.9, 24),
                settings.fontSize,
                measure
            );
            labelLayer.appendChild(
                text(label, arm.labelAnchor, settings.fontSize, theme.labelColor, arm.labelAlign)
            );
        }
    }

    return targets;
}

function frameCellCount(frame: NormalizedFrame): number {
    let total = 0;
    for (const profile of frame.profiles) {
        total += profile.cells.length;
    }
    return total;
}

/**
 * Draws the designed no-data presentation: one centred, bounded card carrying the current state
 * message and the next action. Everything is clamped to the chart rectangle so the card degrades
 * cleanly down to an 80x80 tile instead of escaping the visual root.
 */
function appendEmptyState(svg: SVGSVGElement, input: RenderInput, measure: TextMeasurer): void {
    const { layout, theme, settings, localization } = input;
    const group = element<SVGGElement>("g");
    group.setAttribute("class", "profile-lens-empty");
    // The header, status line and accessible table already carry this text for assistive
    // technology, so the card is decorative and must not be announced a second time.
    group.setAttribute("aria-hidden", "true");
    svg.appendChild(group);

    const chart = layout.chart;
    const micro = layout.tier === "micro";
    const compact = layout.tier === "compact";
    const rawMessage = input.emptyState?.message.trim() ?? "";
    const message = rawMessage.length > 0 ? rawMessage : localization.get("Status_Empty");
    const guidance = input.emptyState?.guidance.trim() ?? "";

    const paddingX = micro ? 4 : 10;
    const paddingY = micro ? 4 : 8;
    const outerWidth = Math.max(chart.width - (micro ? 4 : 12), 8);
    const outerHeight = Math.max(chart.height - (micro ? 4 : 12), 8);
    const maxTextWidth = Math.max(Math.min(outerWidth - paddingX * 2, 320), 8);
    const messageSize = Math.max(
        micro ? settings.fontSize - 3 : compact ? settings.fontSize - 1 : settings.fontSize,
        7
    );
    const guidanceSize = Math.max(messageSize - 1, 7);
    const messageLeading = messageSize * 1.34;
    const guidanceLeading = guidanceSize * 1.32;

    const messageLines = wrapText(message, maxTextWidth, messageSize, 3, measure);
    if (messageLines.length === 0) {
        return;
    }
    let guidanceLines = micro || guidance.length === 0
        ? []
        : wrapText(guidance, maxTextWidth, guidanceSize, 2, measure);
    const gap = guidanceLines.length > 0 ? Math.max(messageSize * 0.4, 3) : 0;
    const contentHeight = (): number =>
        messageLines.length * messageLeading
        + (guidanceLines.length > 0 ? gap + guidanceLines.length * guidanceLeading : 0);
    while (guidanceLines.length > 0 && contentHeight() + paddingY * 2 > outerHeight) {
        guidanceLines = guidanceLines.slice(0, guidanceLines.length - 1);
    }

    const textWidth = Math.max(
        ...messageLines.map((line) => measure(line, messageSize)),
        ...guidanceLines.map((line) => measure(line, guidanceSize)),
        1
    );
    const cardWidth = Math.min(textWidth + paddingX * 2, outerWidth);
    const cardHeight = Math.min(contentHeight() + paddingY * 2, outerHeight);
    const centerX = chart.x + chart.width / 2;
    const centerY = chart.y + chart.height / 2;

    const card = element<SVGRectElement>("rect");
    card.setAttribute("class", "profile-lens-empty-card");
    card.setAttribute("x", String(round(centerX - cardWidth / 2)));
    card.setAttribute("y", String(round(centerY - cardHeight / 2)));
    card.setAttribute("width", String(round(cardWidth)));
    card.setAttribute("height", String(round(cardHeight)));
    card.setAttribute("rx", String(micro ? 3 : 6));
    card.setAttribute("fill", theme.background);
    card.setAttribute("fill-opacity", theme.isHighContrast ? "1" : "0.92");
    card.setAttribute("stroke", theme.isHighContrast ? theme.foreground : theme.gridColor);
    card.setAttribute("stroke-width", "1");
    group.appendChild(card);

    const contentTop = centerY - contentHeight() / 2;
    messageLines.forEach((line, index) => {
        const node = text(
            line,
            { x: centerX, y: contentTop + messageLeading * (index + 0.5) },
            messageSize,
            theme.foreground,
            "middle"
        );
        node.setAttribute("class", "profile-lens-empty-message");
        node.setAttribute("font-weight", "600");
        group.appendChild(node);
    });
    const guidanceTop = contentTop + messageLines.length * messageLeading + gap;
    guidanceLines.forEach((line, index) => {
        const node = text(
            line,
            { x: centerX, y: guidanceTop + guidanceLeading * (index + 0.5) },
            guidanceSize,
            theme.labelColor,
            "middle"
        );
        node.setAttribute("class", "profile-lens-empty-guidance");
        group.appendChild(node);
    });
}

function appendBandLabels(
    labelLayer: SVGGElement,
    input: RenderInput,
    arm: ArmLayout,
    bandCount: number,
    measure: TextMeasurer
): void {
    const slot = arm.bandExtent / bandCount;
    const budget = Math.max(slot * 1.6, 16);
    for (const band of input.model.bands) {
        const local: Point = {
            x: arm.bandStart + slot * band.index + slot / 2,
            y: arm.valueExtent + 8
        };
        const anchor = rotate(local, arm.angleDegrees, arm.origin);
        const label = fitText(band.label, budget, input.settings.fontSize - 1, measure);
        if (label.length === 0) {
            continue;
        }
        labelLayer.appendChild(
            text(label, anchor, input.settings.fontSize - 1, input.theme.labelColor, "middle")
        );
    }
}

function describeCell(input: RenderInput, cell: NormalizedCell, profileIndex: number): string {
    const profile = input.model.profiles[profileIndex];
    const band = input.model.bands[cell.bandIndex];
    const series = cell.seriesIndex === IMPLICIT_INDEX
        ? input.localization.get("Legend_SingleSeries")
        : input.model.series[cell.seriesIndex]?.label ?? "";
    const value = cell.state === "nonNumeric"
        ? input.localization.get("Aria_NonNumericUnsupported")
        : cell.state === "nonFinite"
            ? input.localization.format(
                "Aria_NonFiniteUnsupported",
                input.localization.formatNumber(cell.raw ?? Number.NaN)
            )
            : cell.state === "negativeValue"
        ? input.localization.format(
            "Aria_NegativeUnsupported",
            input.localization.formatNumber(cell.raw ?? 0)
        )
            : cell.state === "zeroDenominator"
                ? input.localization.format(
                    "Aria_ZeroDenominator",
                    input.localization.formatNumber(cell.raw ?? 0)
                )
                : cell.state === "value" && cell.display !== null
                    ? formatDisplayValue(
                        cell.display,
                        input.frame.mode,
                        input.localization.currentLocale
                    )
                    : input.localization.get("Aria_MissingValue");
    return input.localization.format(
        "Aria_Segment",
        profile?.label ?? "",
        band?.label ?? "",
        series,
        value
    );
}

function fillFor(theme: Theme, seriesSlot: number): string {
    if (theme.usePatterns && seriesSlot === 1) {
        return "url(#profile-lens-pattern-secondary)";
    }
    return seriesColor(theme, seriesSlot);
}

function buildPatternDefs(theme: Theme): SVGDefsElement {
    const defs = element<SVGDefsElement>("defs");
    const pattern = element<SVGPatternElement>("pattern");
    pattern.setAttribute("id", "profile-lens-pattern-secondary");
    pattern.setAttribute("width", "6");
    pattern.setAttribute("height", "6");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    const background = element<SVGRectElement>("rect");
    background.setAttribute("width", "6");
    background.setAttribute("height", "6");
    background.setAttribute("fill", theme.isHighContrast ? theme.background : theme.seriesColors[1]);
    const stroke = element<SVGPathElement>("path");
    stroke.setAttribute("d", "M0,6 L6,0");
    stroke.setAttribute("stroke", theme.isHighContrast ? theme.foreground : "#FFFFFF");
    stroke.setAttribute("stroke-width", "2");
    pattern.appendChild(background);
    pattern.appendChild(stroke);
    defs.appendChild(pattern);
    return defs;
}

export function rotate(local: Point, angleDegrees: number, origin: Point): Point {
    const radians = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: origin.x + local.x * cos + local.y * sin,
        y: origin.y - local.x * sin + local.y * cos
    };
}

function text(
    content: string,
    at: Point,
    fontSize: number,
    color: string,
    anchor: "start" | "middle" | "end"
): SVGTextElement {
    const node = element<SVGTextElement>("text");
    node.setAttribute("x", String(round(at.x)));
    node.setAttribute("y", String(round(at.y)));
    node.setAttribute("font-size", `${fontSize}px`);
    node.setAttribute("fill", color);
    node.setAttribute("text-anchor", anchor);
    node.setAttribute("dominant-baseline", "middle");
    node.textContent = content;
    return node;
}

function element<T extends SVGElement>(name: string): T {
    return document.createElementNS(SVG_NS, name) as T;
}

function clear(node: Element): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}
