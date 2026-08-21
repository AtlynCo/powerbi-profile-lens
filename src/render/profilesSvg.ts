import {
    ArmLayout,
    Point,
    ProfileLayout,
    bandLabelOffset,
    bandSegment
} from "../layout/profileLayout";
import { TextMeasurer, estimateTextWidth, fitText, wrapText } from "../layout/textFit";
import { ResolvedSettings } from "../formatting";
import { Localization } from "../localization";
import { IMPLICIT_INDEX, NormalizationMode, ProfileDataModel } from "../model/contract";
import { NormalizedCell, NormalizedFrame, formatDisplayValue } from "../model/normalization";
import { Theme, seriesFill } from "./theme";
import {
    LABEL_CAPS,
    LabelCandidate,
    LabelSlot,
    PlacementResult,
    placeLabels
} from "./labelPlacement";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Priority classes for the label placement pass. Lower wins when two labels would collide. */
const LABEL_PRIORITY = {
    armCaption: 0,
    scale: 1,
    band: 2,
    value: 3
} as const;

const LABEL_PADDING = 1.5;
const LABEL_LINE_RATIO = 1.22;

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
 *
 * Every label goes through one deterministic, capped placement pass instead of being written at a
 * computed position and hoped for. That is what turns "Band 5Band 4Band 3Band 2Band 1" into either
 * a readable label or no label at all.
 */
export function renderProfiles(svg: SVGSVGElement, input: RenderInput): readonly RenderedTarget[] {
    const { layout, theme, localization } = input;
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
    // The containment is a property of the composition, not of the data, so the scrim and aperture
    // stay put while the probe crosses empty geography. Dropping them there would make the map
    // flash between dimmed and live on every ocean crossing.
    svg.appendChild(buildDefs(theme, layout));
    appendLens(svg, input);

    if (frameCellCount(input.frame) === 0) {
        svg.setAttribute("data-empty", "true");
        appendEmptyState(svg, input, measure);
        return [];
    }
    svg.removeAttribute("data-empty");

    const chartLayer = element<SVGGElement>("g");
    chartLayer.setAttribute("class", "profile-lens-chart-layer");
    const labelLayer = element<SVGGElement>("g");
    labelLayer.setAttribute("class", "profile-lens-label-layer");
    labelLayer.setAttribute("aria-hidden", "true");
    labelLayer.setAttribute("pointer-events", "none");
    svg.appendChild(chartLayer);
    svg.appendChild(labelLayer);

    const targets: RenderedTarget[] = [];
    const candidates: LabelCandidate[] = [];
    const bandCount = Math.max(input.model.bands.length, 1);
    const fontSize = layout.labelFontSize;
    const valueFontSize = Math.max(fontSize - 1, 7);
    const lineHeight = fontSize * LABEL_LINE_RATIO;

    for (const arm of layout.arms) {
        const profile = input.frame.profiles.find((entry) => entry.profileIndex === arm.profileIndex);
        if (!profile) {
            continue;
        }
        const armGroup = element<SVGGElement>("g");
        armGroup.setAttribute("class", "profile-lens-arm");
        armGroup.setAttribute("data-profile-index", String(arm.profileIndex));
        armGroup.setAttribute(
            "transform",
            `translate(${round(arm.origin.x)},${round(arm.origin.y)}) rotate(${round(-arm.angleDegrees)})`
        );
        chartLayer.appendChild(armGroup);

        if (layout.chrome.axis) {
            appendBaseline(armGroup, arm, theme, layout.scale);
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
            const width = Math.max(geometry.width, 1);
            const top = isMissing ? -height : geometry.y;
            rect.setAttribute("class", "profile-lens-bar");
            rect.setAttribute("x", String(round(geometry.x)));
            rect.setAttribute("y", String(round(top)));
            rect.setAttribute("width", String(round(width)));
            rect.setAttribute("height", String(round(height)));
            // Rounded caps. Radius is capped by the shorter side so a short bar becomes a lozenge
            // rather than a clipped rectangle, which is what makes the small values still read.
            const capRadius = Math.min(width * 0.42, height / 2);
            if (capRadius > 0.4) {
                rect.setAttribute("rx", String(round(capRadius)));
                rect.setAttribute("ry", String(round(capRadius)));
            }
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
            // Rounded caps carve the corners out of the shape, and an SVG hit test follows the
            // shape rather than its box. This invisible rectangle keeps the interactive area of a
            // band exactly what it was before the restyle, so hover, tooltip, context menu, click
            // and keyboard targets are unchanged.
            const hit = element<SVGRectElement>("rect");
            hit.setAttribute("class", "profile-lens-bar-hit");
            hit.setAttribute("x", String(round(geometry.x)));
            hit.setAttribute("y", String(round(top)));
            hit.setAttribute("width", String(round(width)));
            hit.setAttribute("height", String(round(height)));
            hit.setAttribute("fill", "none");
            hit.setAttribute("stroke", "none");
            hit.setAttribute("pointer-events", "all");
            hit.setAttribute("aria-hidden", "true");
            group.appendChild(hit);
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
                const text = formatDisplayValue(
                    cell.display,
                    input.frame.mode,
                    localization.currentLocale
                );
                const outward = geometry.y < 0 ? -1 : 1;
                const tip = geometry.y < 0 ? geometry.y : geometry.y + geometry.height;
                const step = valueFontSize * LABEL_LINE_RATIO;
                candidates.push({
                    key: `value:${key}`,
                    text,
                    priority: LABEL_PRIORITY.value,
                    order: arm.profileIndex * 1000 + cell.bandIndex * 10 + seriesSlot,
                    slots: [0, 1, 2].map((index) => rotate(
                        {
                            x: geometry.x + geometry.width / 2,
                            y: tip + outward * (step * 0.62 + index * step)
                        },
                        arm.angleDegrees,
                        arm.origin
                    )),
                    width: measure(text, valueFontSize),
                    height: step,
                    align: "middle",
                    fontSize: valueFontSize,
                    kind: "value",
                    color: theme.labelColor
                });
            }
        }

        if (layout.chrome.bandLabels) {
            collectBandLabels(candidates, input, arm, bandCount, measure, fontSize);
        }

        const profileRef = input.model.profiles[arm.profileIndex];
        // Caption and scale stack away from the chart centre in screen space, and fall back to the
        // opposite side when the preferred one runs into the chart edge. Stacking radially collapses
        // once the anchor is clamped, and a single line of separation is inside the collision
        // padding, so the step is deliberately wider than one line.
        const away = arm.labelAnchor.y >= layout.center.y ? 1 : -1;
        const step = lineHeight * 1.3;
        const stack = (offset: number): LabelSlot => ({
            x: arm.labelAnchor.x,
            y: arm.labelAnchor.y + away * offset * step
        });
        if (profileRef && layout.chrome.armCaptions) {
            const budget = Math.max(layout.radius * 0.9, 24);
            const caption = fitText(profileRef.label, budget, fontSize, measure);
            if (caption.length > 0) {
                candidates.push({
                    key: `caption:${arm.profileIndex}`,
                    text: caption,
                    priority: LABEL_PRIORITY.armCaption,
                    order: arm.profileIndex,
                    slots: [0, 1, -1].map(stack),
                    width: measure(caption, fontSize),
                    height: lineHeight,
                    align: arm.labelAlign,
                    fontSize,
                    kind: "caption",
                    color: theme.labelColor,
                    weight: "600"
                });
            }
        }

        if (layout.chrome.scaleAnnotation) {
            const scaleText = fitText(
                scaleAnnotationFor(input, profile.axisMaximum),
                Math.max(layout.radius * 0.9, 24),
                valueFontSize,
                measure
            );
            if (scaleText.length > 0) {
                candidates.push({
                    key: `scale:${arm.profileIndex}`,
                    text: scaleText,
                    priority: LABEL_PRIORITY.scale,
                    order: arm.profileIndex,
                    slots: [1, -1, 2, -2].map(stack),
                    width: measure(scaleText, valueFontSize),
                    height: valueFontSize * LABEL_LINE_RATIO,
                    align: arm.labelAlign,
                    fontSize: valueFontSize,
                    kind: "scale",
                    color: theme.labelColor
                });
            }
        }
    }

    const placement = placeLabels(candidates, {
        // Deflated so a label clamped to the edge still keeps a hairline of margin inside the
        // surface rather than sitting exactly on the clip boundary.
        bounds: {
            x: layout.chart.x + 4,
            y: layout.chart.y + 4,
            width: Math.max(layout.chart.width - 8, 1),
            height: Math.max(layout.chart.height - 8, 1)
        },
        cap: LABEL_CAPS[layout.tier],
        padding: LABEL_PADDING
    });
    appendPlacedLabels(labelLayer, placement);
    return targets;
}

function appendPlacedLabels(labelLayer: SVGGElement, placement: PlacementResult): void {
    labelLayer.setAttribute("data-label-cap", String(placement.cap));
    labelLayer.setAttribute("data-label-count", String(placement.placed.length));
    labelLayer.setAttribute("data-label-skipped", String(placement.skipped));
    for (const label of placement.placed) {
        const node = text(label.text, { x: label.x, y: label.y }, label.fontSize, label.color, label.align);
        node.setAttribute("class", `profile-lens-chart-label profile-lens-chart-label-${label.kind}`);
        node.setAttribute("data-label-kind", label.kind);
        node.setAttribute("data-label-key", label.key);
        if (label.weight) {
            node.setAttribute("font-weight", label.weight);
        }
        labelLayer.appendChild(node);
    }
}

/**
 * Draws the screen-space lens: a dimming scrim over the cartography with a clear circular aperture
 * at the fixed centre probe, plus a rim that states where the measurement is taken.
 *
 * The whole group is inert. It carries no identity, it is excluded from picking by the surface
 * stylesheet and by an explicit pointer-events rule, and it is hidden from assistive technology,
 * so selection, tooltips, the accessible table and every announcement are unchanged.
 */
function appendLens(svg: SVGSVGElement, input: RenderInput): void {
    const lens = input.layout.lens;
    if (!lens) {
        return;
    }
    const { theme } = input;
    const group = element<SVGGElement>("g");
    group.setAttribute("class", "profile-lens-lens");
    group.setAttribute("aria-hidden", "true");
    group.setAttribute("pointer-events", "none");
    group.setAttribute("data-aperture-radius", String(round(lens.apertureRadius)));

    if (theme.lens.scrimOpacity > 0) {
        const scrim = element<SVGRectElement>("rect");
        scrim.setAttribute("class", "profile-lens-lens-scrim");
        scrim.setAttribute("x", String(round(lens.scrim.x)));
        scrim.setAttribute("y", String(round(lens.scrim.y)));
        scrim.setAttribute("width", String(round(lens.scrim.width)));
        scrim.setAttribute("height", String(round(lens.scrim.height)));
        scrim.setAttribute("fill", theme.lens.scrim);
        scrim.setAttribute("fill-opacity", String(theme.lens.scrimOpacity));
        scrim.setAttribute("mask", "url(#profile-lens-aperture-mask)");
        scrim.setAttribute("pointer-events", "none");
        group.appendChild(scrim);
    }

    const rim = element<SVGCircleElement>("circle");
    rim.setAttribute("class", "profile-lens-lens-rim");
    rim.setAttribute("cx", String(round(lens.center.x)));
    rim.setAttribute("cy", String(round(lens.center.y)));
    rim.setAttribute("r", String(round(lens.apertureRadius)));
    rim.setAttribute("fill", "none");
    rim.setAttribute("stroke", theme.lens.rim);
    rim.setAttribute("stroke-opacity", String(theme.lens.rimOpacity));
    rim.setAttribute("stroke-width", String(round(Math.max(input.layout.scale, 0.5))));
    rim.setAttribute("pointer-events", "none");
    group.appendChild(rim);
    svg.appendChild(group);
}

function buildDefs(theme: Theme, layout: ProfileLayout): SVGDefsElement {
    const defs = element<SVGDefsElement>("defs");
    if (theme.usePatterns && layout.seriesCount > 1) {
        defs.appendChild(buildSeriesTexture(theme));
    }
    if (layout.lens) {
        defs.appendChild(buildApertureMask(layout));
    }
    return defs;
}

function buildApertureMask(layout: ProfileLayout): SVGMaskElement {
    const lens = layout.lens!;
    const mask = element<SVGMaskElement>("mask");
    mask.setAttribute("id", "profile-lens-aperture-mask");
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.setAttribute("x", String(round(lens.scrim.x)));
    mask.setAttribute("y", String(round(lens.scrim.y)));
    mask.setAttribute("width", String(round(lens.scrim.width)));
    mask.setAttribute("height", String(round(lens.scrim.height)));
    const cover = element<SVGRectElement>("rect");
    cover.setAttribute("x", String(round(lens.scrim.x)));
    cover.setAttribute("y", String(round(lens.scrim.y)));
    cover.setAttribute("width", String(round(lens.scrim.width)));
    cover.setAttribute("height", String(round(lens.scrim.height)));
    cover.setAttribute("fill", "#FFFFFF");
    const hole = element<SVGCircleElement>("circle");
    hole.setAttribute("cx", String(round(lens.center.x)));
    hole.setAttribute("cy", String(round(lens.center.y)));
    hole.setAttribute("r", String(round(lens.apertureRadius)));
    hole.setAttribute("fill", "#000000");
    mask.appendChild(cover);
    mask.appendChild(hole);
    return mask;
}

/**
 * Draws the baseline and its inner tick.
 *
 * A mirrored arm reads as a pyramid, so the baseline is the spine the two series grow away from and
 * it has to be legible in its own right rather than a hairline the bars swallow.
 */
function appendBaseline(
    armGroup: SVGGElement,
    arm: ArmLayout,
    theme: Theme,
    scale: number
): void {
    const strokeWidth = Math.max(1, Math.round(1.4 * scale * 100) / 100);
    const axis = element<SVGLineElement>("line");
    axis.setAttribute("class", "profile-lens-axis");
    axis.setAttribute("x1", String(round(arm.bandStart)));
    axis.setAttribute("y1", "0");
    axis.setAttribute("x2", String(round(arm.bandStart + arm.bandExtent)));
    axis.setAttribute("y2", "0");
    axis.setAttribute("stroke", theme.axisColor);
    axis.setAttribute("stroke-width", String(strokeWidth));
    axis.setAttribute("stroke-linecap", "round");
    armGroup.appendChild(axis);

    const tickHalf = Math.max(arm.axisGutter / 2, 3 * scale);
    const tick = element<SVGLineElement>("line");
    tick.setAttribute("class", "profile-lens-axis-tick");
    tick.setAttribute("x1", String(round(arm.bandStart)));
    tick.setAttribute("y1", String(round(-tickHalf)));
    tick.setAttribute("x2", String(round(arm.bandStart)));
    tick.setAttribute("y2", String(round(tickHalf)));
    tick.setAttribute("stroke", theme.axisColor);
    tick.setAttribute("stroke-width", String(strokeWidth));
    tick.setAttribute("stroke-linecap", "round");
    armGroup.appendChild(tick);
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

/**
 * Collects one band label per band, on every arm.
 *
 * The anchor comes from the band's own geometry, never from the far edge of the value budget, so a
 * label sits beside the bars it describes rather than hundreds of pixels away from them. A mirrored
 * arm puts them in the axis gutter, exactly where a population pyramid carries its band scale; an
 * unmirrored arm puts them on the free side of the baseline. Both offer bounded stagger slots for
 * the placement pass to fall back on.
 */
function collectBandLabels(
    candidates: LabelCandidate[],
    input: RenderInput,
    arm: ArmLayout,
    bandCount: number,
    measure: TextMeasurer,
    fontSize: number
): void {
    const slot = arm.bandExtent / bandCount;
    const radians = (arm.angleDegrees * Math.PI) / 180;
    // A mirrored band label lives in the axis gutter, so its budget is whatever the gutter can
    // show along the arm's perpendicular, not the band slot.
    const gutterBudget = Math.abs(Math.sin(radians)) < 0.15
        ? Math.max(slot * 1.4, 18)
        : Math.max(arm.axisGutter - arm.bandGap, 12);
    const budget = arm.mirrored ? gutterBudget : Math.max(slot * 1.4, 18);
    const baseOffset = bandLabelOffset(arm, fontSize);
    const step = fontSize * LABEL_LINE_RATIO;
    const outside = arm.valueExtent + step * 0.7;
    for (const band of input.model.bands) {
        const label = fitText(band.label, budget, fontSize, measure);
        if (label.length === 0) {
            continue;
        }
        const along = arm.bandStart + slot * band.index + slot / 2;
        // Stay adjacent to the band first: step away from the baseline before giving up and
        // crossing to the far side of the bars, so a displaced label still reads as this band's.
        const offsets = arm.mirrored
            ? [baseOffset, outside, -outside, baseOffset + step]
            : [baseOffset, baseOffset + step, baseOffset + step * 2, -outside];
        candidates.push({
            key: `band:${arm.profileIndex}:${band.index}`,
            text: label,
            priority: LABEL_PRIORITY.band,
            order: arm.profileIndex * 1000 + band.index,
            slots: offsets.map((offset): LabelSlot =>
                rotate({ x: along, y: offset }, arm.angleDegrees, arm.origin)),
            width: measure(label, fontSize),
            height: step,
            align: "middle",
            fontSize,
            kind: "band",
            color: input.theme.labelColor
        });
    }
}

const NORMALIZATION_KEYS = {
    raw: "Format_Normalization_Raw",
    shareOfProfile: "Format_Normalization_ShareOfProfile",
    shareWithinSeries: "Format_Normalization_ShareWithinSeries",
    indexToMaximum: "Format_Normalization_IndexToMaximum",
    alreadyPercent: "Format_Normalization_AlreadyPercent"
} as const satisfies Readonly<Record<NormalizationMode, string>>;

/**
 * Scale annotation for one arm: the axis maximum, plus the normalization that defines the unit.
 *
 * Without it the chart states magnitudes it never quantifies. Raw values need no qualifier because
 * the number is the value; every proportional mode does, because the same 42% means something
 * different under share of profile and index to maximum.
 */
export function scaleAnnotationFor(input: RenderInput, axisMaximum: number): string {
    const mode = input.frame.mode;
    const value = formatDisplayValue(axisMaximum, mode, input.localization.currentLocale);
    if (mode === "raw") {
        return input.localization.format("Chart_ScaleMaximum", value);
    }
    return input.localization.format(
        "Chart_ScaleMaximumOf",
        value,
        input.localization.get(NORMALIZATION_KEYS[mode])
    );
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
    return seriesFill(theme, seriesSlot);
}

/**
 * Texture for the second series.
 *
 * High contrast keeps the hard diagonal hatch, which is the strongest available differentiator when
 * only two host colours exist. The normal theme uses a fine stipple over the luminance separated
 * fill instead: a diagonal at six rotated arm angles reads as noise, while a dot grid looks the same
 * whichever way the arm points and still gives a non-colour channel for colour-vision deficiency.
 */
function buildSeriesTexture(theme: Theme): SVGPatternElement {
    const pattern = element<SVGPatternElement>("pattern");
    pattern.setAttribute("id", "profile-lens-pattern-secondary");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    if (theme.isHighContrast) {
        pattern.setAttribute("width", "6");
        pattern.setAttribute("height", "6");
        const background = element<SVGRectElement>("rect");
        background.setAttribute("width", "6");
        background.setAttribute("height", "6");
        background.setAttribute("fill", theme.background);
        const stroke = element<SVGPathElement>("path");
        stroke.setAttribute("d", "M0,6 L6,0");
        stroke.setAttribute("stroke", theme.foreground);
        stroke.setAttribute("stroke-width", "2");
        pattern.appendChild(background);
        pattern.appendChild(stroke);
        return pattern;
    }
    pattern.setAttribute("width", "4");
    pattern.setAttribute("height", "4");
    const background = element<SVGRectElement>("rect");
    background.setAttribute("width", "4");
    background.setAttribute("height", "4");
    background.setAttribute("fill", theme.seriesFills[1]);
    const dot = element<SVGCircleElement>("circle");
    dot.setAttribute("cx", "2");
    dot.setAttribute("cy", "2");
    dot.setAttribute("r", "0.9");
    dot.setAttribute("fill", theme.isDark ? "#FFFFFF" : "#000000");
    dot.setAttribute("fill-opacity", "0.28");
    pattern.appendChild(background);
    pattern.appendChild(dot);
    return pattern;
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
