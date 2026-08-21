import { Arrangement } from "../model/contract";

export interface Size {
    readonly width: number;
    readonly height: number;
}

export interface Rect extends Size {
    readonly x: number;
    readonly y: number;
}

export interface Point {
    readonly x: number;
    readonly y: number;
}

export type LayoutKind =
    | "bilateral"
    | "opposing"
    | "triArm"
    | "cardinal"
    | "radial"
    | "stacked";

export type DensityTier = "micro" | "compact" | "medium" | "full";

/**
 * Geometry of one profile arm.
 *
 * Bands progress along the arm, away from the centre, and values extend perpendicular to it. That
 * is what keeps each arm inside its own angular sector: the perpendicular budget is derived from
 * the sector half angle at the inner radius, which is the tightest point, so arms never overlap.
 */
export interface ArmLayout {
    readonly profileIndex: number;
    /** Direction of the band axis in degrees, measured counter clockwise from east. */
    readonly angleDegrees: number;
    readonly origin: Point;
    /** Local x of the first band along the arm. */
    readonly bandStart: number;
    /** Local x length shared by all bands. */
    readonly bandExtent: number;
    /** Maximum perpendicular length of a full magnitude value, per side. */
    readonly valueExtent: number;
    /**
     * Perpendicular width reserved on the axis itself, centred on it.
     *
     * A mirrored arm is a population pyramid: the two series grow away from the axis in opposite
     * directions, so the only place a band label can sit adjacent to its own band is the axis. The
     * gutter is subtracted from the magnitude budget rather than added to it, so the arm still fits
     * inside its angular sector and every existing perpendicular bound continues to hold.
     */
    readonly axisGutter: number;
    readonly bandThickness: number;
    readonly bandGap: number;
    /** True when two series are mirrored on opposite sides of the arm axis. */
    readonly mirrored: boolean;
    readonly labelAnchor: Point;
    readonly labelAlign: "start" | "middle" | "end";
}

/**
 * Screen-space containment for the focus lens.
 *
 * The aperture is a clear circle at the fixed centre probe. The scrim dims the cartography around
 * it and the arms are anchored outside it, so the chart reads as one instrument over a dimmed map
 * instead of loose marks over a live one. Nothing here is expressed in scene coordinates, so the
 * treatment never moves with the camera and never forces a context rebuild.
 */
export interface LensLayout {
    readonly center: Point;
    readonly apertureRadius: number;
    /** Rectangle the scrim must cover, deliberately overscanned past the chart box. */
    readonly scrim: Rect;
}

export interface ChromeVisibility {
    readonly header: boolean;
    readonly legend: boolean;
    readonly periodControl: boolean;
    readonly entityList: boolean;
    readonly bandLabels: boolean;
    readonly valueLabels: boolean;
    /** Measure name beside each arm. Independent of band labels, which are far denser. */
    readonly armCaptions: boolean;
    /** Axis maximum plus normalization context, per arm. */
    readonly scaleAnnotation: boolean;
    readonly axis: boolean;
    readonly status: boolean;
}

export interface ProfileLayout {
    readonly kind: LayoutKind;
    readonly tier: DensityTier;
    readonly viewport: Size;
    readonly chart: Rect;
    readonly center: Point;
    readonly radius: number;
    /**
     * Uniform design-box scale.
     *
     * Bar thickness, gaps, label type and the lens aperture are authored against one design box and
     * multiplied by this factor, so a chart keeps its proportions as the tile shrinks instead of
     * being recomposed with different relative weights at every size.
     */
    readonly scale: number;
    /** Type size labels are drawn at, already scaled by the design box. */
    readonly labelFontSize: number;
    readonly lens: LensLayout | null;
    readonly arms: readonly ArmLayout[];
    readonly chrome: ChromeVisibility;
    readonly bandCount: number;
    readonly seriesCount: number;
}

export interface LayoutRequest {
    readonly viewport: Size;
    readonly profileCount: number;
    readonly bandCount: number;
    readonly seriesCount: number;
    readonly arrangement: Arrangement;
    readonly armRotationDegrees: number;
    readonly requestedBandGap: number;
    readonly requestedThickness: number;
    readonly requestedFontSize?: number;
    /** Estimated widest band label, used to size the mirrored axis gutter. */
    readonly requestedBandLabelWidth?: number;
    readonly showEntityList: boolean;
    readonly showPeriodControl: boolean;
    readonly showLegend: boolean;
    readonly showBandLabels: boolean;
    readonly showValueLabels: boolean;
    readonly showAxis: boolean;
    readonly showHeader: boolean;
    /**
     * True only when the composition is the focus lens and the treatment is enabled. Every other
     * composition leaves it unset, which is what keeps the lens inert for profileOnly, split and
     * locatorInset.
     */
    readonly lensContainment?: boolean;
}

const MICRO_LIMIT = 130;
const COMPACT_LIMIT = 240;
const MEDIUM_LIMIT = 420;
const MIN_BAND_THICKNESS = 1;
const HEADER_HEIGHT = 22;
const STATUS_HEIGHT = 18;
const PERIOD_HEIGHT = 26;
const ENTITY_LIST_WIDTH = 148;
const LEGEND_HEIGHT = 18;
const INNER_RADIUS_RATIO = 0.25;
const HUB_RADIUS_RATIO = 0.06;
const SECTOR_SAFETY = 0.9;
/** Design box the chart proportions are authored against. */
const DESIGN_WIDTH = 620;
const DESIGN_HEIGHT = 420;
const MIN_DESIGN_SCALE = 0.45;
const DEFAULT_FONT_SIZE = 10;
const MIN_LABEL_FONT_SIZE = 7;
const APERTURE_RATIO = 0.19;
const MIN_APERTURE_RADIUS = 14;
const APERTURE_CLEARANCE = 10;
/** Share of the perpendicular half box one side of a single-axis layout may claim. */
const AXIAL_VALUE_RATIO = 0.82;
/**
 * How far past the inscribed circle a radiating arm may reach.
 *
 * The ellipse lets a wide tile spend its width, but an uncapped reach turns three arms into marks
 * scattered from edge to edge instead of one instrument, which is the defect this pass exists to
 * remove. The cap keeps the star compact while still spending more of a wide box than a circle.
 */
const RADIAL_REACH_CAP = 1.15;
/** Most of an arm's perpendicular budget the band-label gutter may take. */
const MAX_GUTTER_SHARE = 0.6;
/** Widest band label the gutter will size itself for. */
const MAX_BAND_LABEL_WIDTH = 96;

/**
 * Uniform scale of the design box inside the chart box.
 *
 * Capped at 1 so a large tile is never inflated: the design box is the size at which the authored
 * proportions are correct, and anything larger simply has more room around them.
 */
export function designScale(chart: Size): number {
    const raw = Math.min(chart.width / DESIGN_WIDTH, chart.height / DESIGN_HEIGHT);
    if (!Number.isFinite(raw)) {
        return MIN_DESIGN_SCALE;
    }
    return Math.min(Math.max(raw, MIN_DESIGN_SCALE), 1);
}


export function densityTier(viewport: Size): DensityTier {
    const smallest = Math.min(viewport.width, viewport.height);
    if (smallest < MICRO_LIMIT) {
        return "micro";
    }
    if (smallest < COMPACT_LIMIT) {
        return "compact";
    }
    if (smallest < MEDIUM_LIMIT) {
        return "medium";
    }
    return "full";
}

export function layoutKindFor(profileCount: number, arrangement: Arrangement): LayoutKind {
    if (arrangement === "stacked") {
        return "stacked";
    }
    if (arrangement === "radial") {
        return "radial";
    }
    switch (Math.max(profileCount, 0)) {
        case 0:
        case 1:
            return "bilateral";
        case 2:
            return "opposing";
        case 3:
            return "triArm";
        case 4:
            return "cardinal";
        default:
            return "radial";
    }
}

/**
 * Pure layout for the profile chart.
 *
 * Nothing here touches the DOM, so the same geometry can be asserted in unit tests and re-checked
 * against the packaged bundle in a real browser. The layout degrades deterministically: every tier
 * keeps the chart inside the viewport, including an 80x80 tile.
 */
export function computeProfileLayout(request: LayoutRequest): ProfileLayout {
    const tier = densityTier(request.viewport);
    const kind = layoutKindFor(request.profileCount, request.arrangement);
    const chrome = resolveChrome(request, tier);

    const top = chrome.header ? HEADER_HEIGHT : 0;
    const bottom = (chrome.status ? STATUS_HEIGHT : 0)
        + (chrome.periodControl ? PERIOD_HEIGHT : 0)
        + (chrome.legend ? LEGEND_HEIGHT : 0);
    const left = chrome.entityList ? ENTITY_LIST_WIDTH : 0;
    const padding = tier === "micro" ? 2 : tier === "compact" ? 4 : 8;

    const chart: Rect = {
        x: left + padding,
        y: top + padding,
        width: Math.max(request.viewport.width - left - padding * 2, 8),
        height: Math.max(request.viewport.height - top - bottom - padding * 2, 8)
    };

    const center: Point = {
        x: chart.x + chart.width / 2,
        y: chart.y + chart.height / 2
    };
    const radius = Math.max(Math.min(chart.width, chart.height) / 2, 4);
    const bandCount = Math.max(request.bandCount, 1);
    const seriesCount = Math.max(request.seriesCount, 1);
    const scale = designScale(chart);
    const labelFontSize = Math.max(
        Math.round((request.requestedFontSize ?? DEFAULT_FONT_SIZE) * scale),
        MIN_LABEL_FONT_SIZE
    );
    const lens = resolveLens(request, kind, chart, center, radius, scale);

    const arms = kind === "stacked"
        ? stackedArms(request, chart, bandCount, seriesCount, chrome, scale, labelFontSize)
        : radialArms(
            request,
            kind,
            chart,
            center,
            radius,
            bandCount,
            seriesCount,
            chrome,
            scale,
            labelFontSize,
            lens
        );

    return {
        kind,
        tier,
        viewport: request.viewport,
        chart,
        center,
        radius,
        scale,
        labelFontSize,
        lens,
        arms,
        chrome,
        bandCount,
        seriesCount
    };
}

/**
 * Lens aperture for the focus composition.
 *
 * Stacked panels are not radial and have no single probe to ring, so the treatment stays inert
 * there as well as for every non-focus composition.
 */
function resolveLens(
    request: LayoutRequest,
    kind: LayoutKind,
    chart: Rect,
    center: Point,
    radius: number,
    scale: number
): LensLayout | null {
    if (!request.lensContainment || kind === "stacked") {
        return null;
    }
    const apertureRadius = Math.max(
        Math.min(radius * APERTURE_RATIO, radius - 4),
        Math.min(MIN_APERTURE_RADIUS * scale, radius / 2)
    );
    // The chart SVG scales its view box to the surface, so a scrim sized exactly to the chart box
    // can leave the surface edges undimmed. Overscanning past every edge and relying on the root
    // clip keeps the veil complete at any aspect ratio.
    const overscanX = chart.width;
    const overscanY = chart.height;
    return {
        center,
        apertureRadius,
        scrim: {
            x: chart.x - overscanX,
            y: chart.y - overscanY,
            width: chart.width + overscanX * 2,
            height: chart.height + overscanY * 2
        }
    };
}

function resolveChrome(request: LayoutRequest, tier: DensityTier): ChromeVisibility {
    const micro = tier === "micro";
    const compact = tier === "compact";
    return {
        header: request.showHeader && !micro,
        legend: request.showLegend && request.seriesCount > 1 && !micro && !compact,
        periodControl: request.showPeriodControl && !micro,
        entityList: request.showEntityList && tier === "full" && request.viewport.width >= 520,
        bandLabels: request.showBandLabels && !micro && !compact,
        valueLabels: request.showValueLabels && tier === "full",
        armCaptions: request.showBandLabels && !micro,
        scaleAnnotation: request.showAxis && (tier === "full" || tier === "medium"),
        axis: request.showAxis && !micro,
        status: !micro
    };
}

function radialArms(
    request: LayoutRequest,
    kind: LayoutKind,
    chart: Rect,
    center: Point,
    radius: number,
    bandCount: number,
    seriesCount: number,
    chrome: ChromeVisibility,
    scale: number,
    labelFontSize: number,
    lens: LensLayout | null
): readonly ArmLayout[] {
    const profileCount = Math.max(request.profileCount, 1);
    const angles = armAngles(kind, profileCount, request.armRotationDegrees);
    const labelReserve = chrome.bandLabels ? Math.min(28 * scale, radius * 0.2) : 2;
    const usableRadius = Math.max(radius - labelReserve, 6);
    const mirrored = seriesCount > 1;
    const labelWidth = request.requestedBandLabelWidth ?? 0;

    return angles.map((angleDegrees, index) => {
        const gutter = axisGutterFor(
            mirrored,
            chrome.bandLabels,
            labelFontSize,
            labelWidth,
            angleDegrees
        );
        const extents = armExtents(
            kind,
            profileCount,
            usableRadius,
            chart,
            angleDegrees,
            labelReserve,
            lens,
            mirrored
        );
        const geometry = bandGeometry(extents.bandExtent, bandCount, request, scale);
        const radians = (angleDegrees * Math.PI) / 180;
        const labelDistance = extents.bandStart + extents.bandExtent + labelReserve * 0.5;
        // Local +y maps to this screen direction, so shifting the baseline stays correct under
        // any arm rotation.
        const origin: Point = {
            x: center.x + Math.sin(radians) * extents.originShift,
            y: center.y + Math.cos(radians) * extents.originShift
        };
        return {
            profileIndex: index,
            angleDegrees,
            origin,
            bandStart: extents.bandStart,
            bandExtent: extents.bandExtent,
            valueExtent: extents.valueExtent,
            axisGutter: Math.min(gutter, extents.valueExtent * MAX_GUTTER_SHARE),
            bandThickness: geometry.thickness,
            bandGap: geometry.gap,
            mirrored,
            labelAnchor: {
                x: origin.x + Math.cos(radians) * labelDistance,
                y: origin.y - Math.sin(radians) * labelDistance
            },
            labelAlign: labelAlignFor(angleDegrees)
        };
    });
}

function stackedArms(
    request: LayoutRequest,
    chart: Rect,
    bandCount: number,
    seriesCount: number,
    chrome: ChromeVisibility,
    scale: number,
    labelFontSize: number
): readonly ArmLayout[] {
    const profileCount = Math.max(request.profileCount, 1);
    const rowHeight = chart.height / profileCount;
    const mirrored = seriesCount > 1;
    const gutter = axisGutterFor(
        mirrored,
        chrome.bandLabels,
        labelFontSize,
        request.requestedBandLabelWidth ?? 0,
        0
    );
    const arms: ArmLayout[] = [];
    for (let index = 0; index < profileCount; index++) {
        const bandExtent = Math.max(chart.width - 8, 6);
        const geometry = bandGeometry(bandExtent, bandCount, request, scale);
        const y = chart.y + rowHeight * index + rowHeight / 2;
        const valueExtent = Math.max(rowHeight / 2 - 4, 2);
        arms.push({
            profileIndex: index,
            angleDegrees: 0,
            origin: { x: chart.x + 4, y },
            bandStart: 0,
            bandExtent,
            valueExtent,
            axisGutter: Math.min(gutter, valueExtent * MAX_GUTTER_SHARE),
            bandThickness: geometry.thickness,
            bandGap: geometry.gap,
            mirrored,
            labelAnchor: { x: chart.x + 4, y: y - rowHeight / 2 + 8 },
            labelAlign: "start"
        });
    }
    return arms;
}

/**
 * Perpendicular width reserved on the axis for band labels.
 *
 * Only a mirrored arm needs it: an unmirrored arm has a free side, so its band labels sit against
 * the baseline without taking anything from the magnitude budget.
 *
 * The width is direction aware. Labels are drawn horizontally whatever the arm angle, so a vertical
 * arm needs a gutter as wide as the text while a horizontal arm only needs one line of height. That
 * is the support width of an axis aligned label box measured along the arm's perpendicular.
 */
function axisGutterFor(
    mirrored: boolean,
    bandLabels: boolean,
    labelFontSize: number,
    labelWidth: number,
    angleDegrees: number
): number {
    if (!mirrored || !bandLabels) {
        return 0;
    }
    const radians = (angleDegrees * Math.PI) / 180;
    const halfWidth = Math.min(Math.max(labelWidth, labelFontSize), MAX_BAND_LABEL_WIDTH) / 2;
    const halfHeight = labelFontSize * 0.62;
    const half = Math.abs(Math.sin(radians)) * halfWidth + Math.abs(Math.cos(radians)) * halfHeight;
    return (half + labelFontSize * 0.3) * 2;
}

function armAngles(
    kind: LayoutKind,
    profileCount: number,
    rotationDegrees: number
): readonly number[] {
    const rotation = normalizeAngle(rotationDegrees);
    switch (kind) {
        case "bilateral":
            return [rotation];
        case "opposing":
            return [normalizeAngle(180 + rotation), rotation];
        case "triArm":
            return [90, 210, 330].map((angle) => normalizeAngle(angle + rotation));
        case "cardinal":
            return [0, 90, 180, 270].map((angle) => normalizeAngle(angle + rotation));
        default: {
            const step = 360 / profileCount;
            return Array.from({ length: profileCount }, (_unused, index) =>
                normalizeAngle(90 + rotation - index * step));
        }
    }
}

interface ArmExtents {
    readonly bandStart: number;
    readonly bandExtent: number;
    readonly valueExtent: number;
    /** Perpendicular offset of the baseline from the chart centre, in the arm's local frame. */
    readonly originShift: number;
}

/** Radius of the ellipse inscribed in the chart box, measured along one direction. */
export function ellipseReach(halfWidth: number, halfHeight: number, angleDegrees: number): number {
    const radians = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(radians) / Math.max(halfWidth, 1e-6);
    const sin = Math.sin(radians) / Math.max(halfHeight, 1e-6);
    const denominator = Math.sqrt(cos * cos + sin * sin);
    return denominator <= 0 ? 0 : 1 / denominator;
}

/**
 * Longest arm of perpendicular half width `halfBreadth` that still fits the chart box.
 *
 * The arm is an oriented rectangle anchored at the centre of the box, so its axis aligned extents
 * are `a|cos| + b|sin|` and `a|sin| + b|cos|`. Solving both for `a` is exact and continuous in the
 * angle, which is what lets the rotation setting sweep without the geometry jumping.
 */
export function maxArmReach(
    halfWidth: number,
    halfHeight: number,
    angleDegrees: number,
    halfBreadth: number
): number {
    const radians = (angleDegrees * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    const byWidth = cos < 1e-6 ? Number.POSITIVE_INFINITY : (halfWidth - halfBreadth * sin) / cos;
    const byHeight = sin < 1e-6 ? Number.POSITIVE_INFINITY : (halfHeight - halfBreadth * cos) / sin;
    return Math.max(Math.min(byWidth, byHeight), 0);
}

function armExtents(
    kind: LayoutKind,
    profileCount: number,
    usableRadius: number,
    chart: Rect,
    angleDegrees: number,
    labelReserve: number,
    lens: LensLayout | null,
    mirrored: boolean
): ArmExtents {
    const halfWidth = Math.max(chart.width / 2 - labelReserve, 6);
    const halfHeight = Math.max(chart.height / 2 - labelReserve, 4);
    const apertureFloor = lens ? lens.apertureRadius + APERTURE_CLEARANCE : 0;

    if (kind === "bilateral" || kind === "opposing") {
        // A single axis owns the whole box, so the budget comes from the box itself rather than
        // from the inscribed circle. That is what stops a wide tile from using a square of itself.
        const alongReach = ellipseReach(halfWidth, halfHeight, angleDegrees);
        const acrossReach = ellipseReach(halfWidth, halfHeight, angleDegrees + 90);
        const halfBreadth = Math.max(
            Math.min(acrossReach * AXIAL_VALUE_RATIO, alongReach * 0.9),
            2
        );
        const reach = Math.max(maxArmReach(halfWidth, halfHeight, angleDegrees, halfBreadth), 6);
        if (kind === "opposing") {
            // The two arms face opposite ways, so a single series already occupies both sides of
            // the centre and there is nothing to recentre.
            const bandStart = Math.max(usableRadius * HUB_RADIUS_RATIO, apertureFloor, 2);
            return {
                bandStart,
                bandExtent: Math.max(reach - bandStart, 6),
                valueExtent: halfBreadth,
                originShift: 0
            };
        }
        if (lens) {
            // The aperture must stay clear, so the single arm radiates from it instead of running
            // through it, and the baseline stays exactly on the probe.
            const bandStart = Math.max(apertureFloor, 2);
            return {
                bandStart,
                bandExtent: Math.max(reach - bandStart, 6),
                valueExtent: halfBreadth,
                originShift: 0
            };
        }
        const bandExtent = Math.max(reach * 2 - 4, 6);
        return {
            bandStart: -bandExtent / 2,
            bandExtent,
            // One series grows to a single side, so it takes the whole perpendicular budget and the
            // baseline drops by half of it. The drawn band ends up centred in the box instead of
            // clinging to the middle line with an empty half beneath it.
            valueExtent: mirrored ? halfBreadth : Math.max(halfBreadth * 2, 2),
            originShift: mirrored ? 0 : halfBreadth
        };
    }

    const sectorHalf = Math.PI / profileCount;
    const tangent = Math.tan(sectorHalf) * SECTOR_SAFETY;
    let reach = Math.max(
        Math.min(
            ellipseReach(halfWidth, halfHeight, angleDegrees),
            usableRadius * RADIAL_REACH_CAP
        ),
        6
    );
    let bandStart = Math.max(reach * INNER_RADIUS_RATIO, apertureFloor, 3);
    // Perpendicular budget that keeps the arm inside its own sector at the inner radius.
    let valueExtent = Math.max(bandStart * tangent, 2);
    reach = Math.max(
        Math.min(reach, maxArmReach(halfWidth, halfHeight, angleDegrees, valueExtent)),
        bandStart + 6
    );
    bandStart = Math.max(Math.min(bandStart, reach - 6), apertureFloor, 3);
    valueExtent = Math.max(bandStart * tangent, 2);
    return {
        bandStart,
        bandExtent: Math.max(reach - bandStart, 6),
        valueExtent,
        originShift: 0
    };
}

interface BandGeometry {
    readonly thickness: number;
    readonly gap: number;
}

function bandGeometry(
    bandExtent: number,
    bandCount: number,
    request: LayoutRequest,
    scale: number
): BandGeometry {
    const slot = bandExtent / bandCount;
    const requestedGap = Math.max(request.requestedBandGap, 0) * scale;
    const gap = Math.min(requestedGap, slot * 0.35);
    const thickness = Math.max(
        Math.min(
            slot - gap,
            Math.max(request.requestedThickness * scale, MIN_BAND_THICKNESS)
        ),
        MIN_BAND_THICKNESS
    );
    return { thickness: Math.min(thickness, slot), gap };
}

function labelAlignFor(angleDegrees: number): "start" | "middle" | "end" {
    const angle = normalizeAngle(angleDegrees);
    if (angle > 100 && angle < 260) {
        return "end";
    }
    if (angle < 80 || angle > 280) {
        return "start";
    }
    return "middle";
}

export function normalizeAngle(angleDegrees: number): number {
    const remainder = angleDegrees % 360;
    return remainder < 0 ? remainder + 360 : remainder;
}

/** Rectangle for one band and series segment, in the arm's local frame. */
export interface BandSegmentGeometry {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Computes one band segment. Bands advance along the arm, values grow perpendicular to it, and two
 * series are mirrored on opposite sides so a single arm reads as a bilateral profile.
 *
 * A mirrored arm keeps a gutter on the axis for the band label. The gutter is taken out of the
 * magnitude budget, never added to it, so `|y|` and `height` stay within `valueExtent`.
 */
export function bandSegment(
    arm: ArmLayout,
    bandIndex: number,
    bandCount: number,
    seriesIndex: number,
    normalizedValue: number
): BandSegmentGeometry {
    const slot = arm.bandExtent / Math.max(bandCount, 1);
    const thickness = Math.max(Math.min(arm.bandThickness, slot - arm.bandGap), MIN_BAND_THICKNESS);
    const x = arm.bandStart + slot * bandIndex + (slot - thickness) / 2;

    if (arm.mirrored) {
        const gutter = Math.max(Math.min(arm.axisGutter, arm.valueExtent), 0) / 2;
        const budget = Math.max(arm.valueExtent - gutter, 0);
        const magnitude = Math.max(Math.min(Math.abs(normalizedValue), 1), 0) * budget;
        return {
            x,
            y: seriesIndex >= 1 ? gutter : -(gutter + magnitude),
            width: thickness,
            height: magnitude
        };
    }
    const magnitude = Math.max(Math.min(Math.abs(normalizedValue), 1), 0) * arm.valueExtent;
    return {
        x,
        y: -magnitude,
        width: thickness,
        height: magnitude
    };
}

/** Perpendicular offset of the band label from the arm axis, in the arm's local frame. */
export function bandLabelOffset(arm: ArmLayout, labelFontSize: number): number {
    if (arm.mirrored) {
        return 0;
    }
    return Math.max(labelFontSize * 0.85, 6);
}
