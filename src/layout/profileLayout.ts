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
    readonly bandThickness: number;
    readonly bandGap: number;
    /** True when two series are mirrored on opposite sides of the arm axis. */
    readonly mirrored: boolean;
    readonly labelAnchor: Point;
    readonly labelAlign: "start" | "middle" | "end";
}

export interface ChromeVisibility {
    readonly header: boolean;
    readonly legend: boolean;
    readonly periodControl: boolean;
    readonly entityList: boolean;
    readonly bandLabels: boolean;
    readonly valueLabels: boolean;
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
    readonly showEntityList: boolean;
    readonly showPeriodControl: boolean;
    readonly showLegend: boolean;
    readonly showBandLabels: boolean;
    readonly showValueLabels: boolean;
    readonly showAxis: boolean;
    readonly showHeader: boolean;
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

    const arms = kind === "stacked"
        ? stackedArms(request, chart, bandCount, seriesCount)
        : radialArms(request, kind, chart, center, radius, bandCount, seriesCount, chrome);

    return {
        kind,
        tier,
        viewport: request.viewport,
        chart,
        center,
        radius,
        arms,
        chrome,
        bandCount,
        seriesCount
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
    chrome: ChromeVisibility
): readonly ArmLayout[] {
    const profileCount = Math.max(request.profileCount, 1);
    const angles = armAngles(kind, profileCount, request.armRotationDegrees);
    const labelReserve = chrome.bandLabels ? Math.min(28, radius * 0.2) : 2;
    const usableRadius = Math.max(radius - labelReserve, 6);

    return angles.map((angleDegrees, index) => {
        const extents = armExtents(kind, profileCount, usableRadius, chart);
        const geometry = bandGeometry(extents.bandExtent, bandCount, request);
        const radians = (angleDegrees * Math.PI) / 180;
        const labelDistance = extents.bandStart + extents.bandExtent + labelReserve * 0.5;
        return {
            profileIndex: index,
            angleDegrees,
            origin: center,
            bandStart: extents.bandStart,
            bandExtent: extents.bandExtent,
            valueExtent: extents.valueExtent,
            bandThickness: geometry.thickness,
            bandGap: geometry.gap,
            mirrored: seriesCount > 1,
            labelAnchor: {
                x: center.x + Math.cos(radians) * labelDistance,
                y: center.y - Math.sin(radians) * labelDistance
            },
            labelAlign: labelAlignFor(angleDegrees)
        };
    });
}

function stackedArms(
    request: LayoutRequest,
    chart: Rect,
    bandCount: number,
    seriesCount: number
): readonly ArmLayout[] {
    const profileCount = Math.max(request.profileCount, 1);
    const rowHeight = chart.height / profileCount;
    const arms: ArmLayout[] = [];
    for (let index = 0; index < profileCount; index++) {
        const bandExtent = Math.max(chart.width - 8, 6);
        const geometry = bandGeometry(bandExtent, bandCount, request);
        const y = chart.y + rowHeight * index + rowHeight / 2;
        arms.push({
            profileIndex: index,
            angleDegrees: 0,
            origin: { x: chart.x + 4, y },
            bandStart: 0,
            bandExtent,
            valueExtent: Math.max(rowHeight / 2 - 4, 2),
            bandThickness: geometry.thickness,
            bandGap: geometry.gap,
            mirrored: seriesCount > 1,
            labelAnchor: { x: chart.x + 4, y: y - rowHeight / 2 + 8 },
            labelAlign: "start"
        });
    }
    return arms;
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
}

function armExtents(
    kind: LayoutKind,
    profileCount: number,
    usableRadius: number,
    chart: Rect
): ArmExtents {
    if (kind === "bilateral") {
        // A single arm owns the whole tile, so its band axis is centred on the origin.
        const bandExtent = Math.max(Math.min(chart.width, usableRadius * 2) - 4, 6);
        return {
            bandStart: -bandExtent / 2,
            bandExtent,
            valueExtent: Math.max(Math.min(chart.height / 2, usableRadius) - 4, 2)
        };
    }
    if (kind === "opposing") {
        const bandStart = Math.max(usableRadius * HUB_RADIUS_RATIO, 2);
        return {
            bandStart,
            bandExtent: Math.max(usableRadius - bandStart, 6),
            valueExtent: Math.max(usableRadius * 0.45, 2)
        };
    }
    const bandStart = Math.max(usableRadius * INNER_RADIUS_RATIO, 3);
    const sectorHalf = Math.PI / profileCount;
    // Perpendicular budget that keeps the arm inside its own sector at the inner radius.
    const valueExtent = Math.max(bandStart * Math.tan(sectorHalf) * SECTOR_SAFETY, 2);
    return {
        bandStart,
        bandExtent: Math.max(usableRadius - bandStart, 6),
        valueExtent
    };
}

interface BandGeometry {
    readonly thickness: number;
    readonly gap: number;
}

function bandGeometry(
    bandExtent: number,
    bandCount: number,
    request: LayoutRequest
): BandGeometry {
    const slot = bandExtent / bandCount;
    const requestedGap = Math.max(request.requestedBandGap, 0);
    const gap = Math.min(requestedGap, slot * 0.35);
    const thickness = Math.max(
        Math.min(slot - gap, Math.max(request.requestedThickness, MIN_BAND_THICKNESS)),
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
    const magnitude = Math.max(Math.min(Math.abs(normalizedValue), 1), 0) * arm.valueExtent;

    if (arm.mirrored) {
        return {
            x,
            y: seriesIndex >= 1 ? 0 : -magnitude,
            width: thickness,
            height: magnitude
        };
    }
    return {
        x,
        y: -magnitude,
        width: thickness,
        height: magnitude
    };
}
