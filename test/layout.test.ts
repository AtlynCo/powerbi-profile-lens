import { describe, expect, it } from "vitest";
import {
    LayoutRequest,
    bandSegment,
    computeProfileLayout,
    densityTier,
    layoutKindFor,
    normalizeAngle
} from "../src/layout/profileLayout";
import { estimateTextWidth, fitText } from "../src/layout/textFit";

function request(overrides: Partial<LayoutRequest> = {}): LayoutRequest {
    return {
        viewport: { width: 1280, height: 620 },
        profileCount: 3,
        bandCount: 5,
        seriesCount: 2,
        arrangement: "auto",
        armRotationDegrees: 0,
        requestedBandGap: 1,
        requestedThickness: 14,
        showEntityList: true,
        showPeriodControl: true,
        showLegend: true,
        showBandLabels: true,
        showValueLabels: true,
        showAxis: true,
        showHeader: true,
        ...overrides
    };
}

describe("profile layout", () => {
    it("maps profile counts to the documented arrangements", () => {
        expect(layoutKindFor(1, "auto")).toBe("bilateral");
        expect(layoutKindFor(2, "auto")).toBe("opposing");
        expect(layoutKindFor(3, "auto")).toBe("triArm");
        expect(layoutKindFor(4, "auto")).toBe("cardinal");
        expect(layoutKindFor(5, "auto")).toBe("radial");
        expect(layoutKindFor(6, "auto")).toBe("radial");
        expect(layoutKindFor(1, "radial")).toBe("radial");
        expect(layoutKindFor(4, "radial")).toBe("radial");
        expect(layoutKindFor(3, "stacked")).toBe("stacked");
    });

    it("produces one arm per profile with the documented angles", () => {
        expect(computeProfileLayout(request({ profileCount: 1 })).arms.map((arm) => arm.angleDegrees))
            .toEqual([0]);
        expect(computeProfileLayout(request({ profileCount: 2 })).arms.map((arm) => arm.angleDegrees))
            .toEqual([180, 0]);
        expect(computeProfileLayout(request({ profileCount: 3 })).arms.map((arm) => arm.angleDegrees))
            .toEqual([90, 210, 330]);
        expect(computeProfileLayout(request({ profileCount: 4 })).arms.map((arm) => arm.angleDegrees))
            .toEqual([0, 90, 180, 270]);
        const radial = computeProfileLayout(request({ profileCount: 6 }));
        expect(radial.arms.map((arm) => Math.round(arm.angleDegrees)))
            .toEqual([90, 30, 330, 270, 210, 150]);
    });

    it("rotates every arm by the configured rotation", () => {
        const rotated = computeProfileLayout(request({ profileCount: 4, armRotationDegrees: 45 }));
        expect(rotated.arms.map((arm) => arm.angleDegrees)).toEqual([45, 135, 225, 315]);
        expect(normalizeAngle(-30)).toBe(330);
    });

    it("mirrors two series around one axis when a series is bound", () => {
        expect(computeProfileLayout(request({ profileCount: 1, seriesCount: 2 })).arms[0].mirrored)
            .toBe(true);
        expect(computeProfileLayout(request({ profileCount: 1, seriesCount: 1 })).arms[0].mirrored)
            .toBe(false);
        expect(computeProfileLayout(request({ profileCount: 3, seriesCount: 2 })).arms[0].mirrored)
            .toBe(true);
    });

    it("classifies density tiers and drops chrome as the tile shrinks", () => {
        expect(densityTier({ width: 1280, height: 620 })).toBe("full");
        expect(densityTier({ width: 398, height: 298 })).toBe("medium");
        expect(densityTier({ width: 258, height: 198 })).toBe("compact");
        expect(densityTier({ width: 80, height: 80 })).toBe("micro");

        const micro = computeProfileLayout(request({ viewport: { width: 80, height: 80 } }));
        expect(micro.chrome).toEqual({
            header: false,
            legend: false,
            periodControl: false,
            entityList: false,
            bandLabels: false,
            valueLabels: false,
            axis: false,
            status: false
        });

        const compact = computeProfileLayout(request({ viewport: { width: 258, height: 198 } }));
        expect(compact.chrome.valueLabels).toBe(false);
        expect(compact.chrome.bandLabels).toBe(false);
        expect(compact.chrome.header).toBe(true);
    });

    it("keeps the chart inside an 80x80 tile", () => {
        const layout = computeProfileLayout(request({ viewport: { width: 80, height: 80 } }));
        expect(layout.chart.x).toBeGreaterThanOrEqual(0);
        expect(layout.chart.y).toBeGreaterThanOrEqual(0);
        expect(layout.chart.x + layout.chart.width).toBeLessThanOrEqual(80);
        expect(layout.chart.y + layout.chart.height).toBeLessThanOrEqual(80);
        expect(layout.radius).toBeGreaterThan(0);
        for (const arm of layout.arms) {
            expect(arm.bandExtent).toBeGreaterThan(0);
            expect(arm.bandStart + arm.bandExtent).toBeLessThanOrEqual(layout.radius);
            expect(arm.valueExtent).toBeGreaterThan(0);
            expect(arm.bandThickness).toBeGreaterThan(0);
        }
    });

    it("keeps every arm inside its own angular sector so arms never overlap", () => {
        for (const profileCount of [3, 4, 5, 6]) {
            const layout = computeProfileLayout(request({ profileCount }));
            const sectorHalf = Math.PI / profileCount;
            for (const arm of layout.arms) {
                const widestAngle = Math.atan(arm.valueExtent / arm.bandStart);
                expect(widestAngle, `profileCount ${profileCount}`).toBeLessThanOrEqual(sectorHalf);
            }
        }
    });

    it("keeps band segments inside the arm and free of overlap", () => {
        const layout = computeProfileLayout(request({ profileCount: 3, bandCount: 5, seriesCount: 2 }));
        const arm = layout.arms[0];
        const segments = [];
        for (let bandIndex = 0; bandIndex < 5; bandIndex++) {
            for (let seriesIndex = 0; seriesIndex < 2; seriesIndex++) {
                segments.push({
                    bandIndex,
                    seriesIndex,
                    ...bandSegment(arm, bandIndex, 5, seriesIndex, 1)
                });
            }
        }
        for (const segment of segments) {
            expect(segment.x).toBeGreaterThanOrEqual(arm.bandStart - 0.001);
            expect(segment.x + segment.width)
                .toBeLessThanOrEqual(arm.bandStart + arm.bandExtent + 0.001);
            expect(Math.abs(segment.y)).toBeLessThanOrEqual(arm.valueExtent + 0.001);
            expect(segment.height).toBeLessThanOrEqual(arm.valueExtent + 0.001);
        }
        const firstSeries = segments
            .filter((segment) => segment.seriesIndex === 0)
            .sort((left, right) => left.x - right.x);
        for (let index = 1; index < firstSeries.length; index++) {
            expect(firstSeries[index].x + 0.001)
                .toBeGreaterThanOrEqual(firstSeries[index - 1].x + firstSeries[index - 1].width);
        }
    });

    it("scales segment length with the normalized value", () => {
        const arm = computeProfileLayout(request({ profileCount: 1, seriesCount: 1 })).arms[0];
        expect(bandSegment(arm, 0, 5, 0, 0).height).toBe(0);
        expect(bandSegment(arm, 0, 5, 0, 0.5).height).toBeCloseTo(arm.valueExtent / 2, 6);
        expect(bandSegment(arm, 0, 5, 0, 1).height).toBeCloseTo(arm.valueExtent, 6);
        expect(bandSegment(arm, 0, 5, 0, 4).height).toBeCloseTo(arm.valueExtent, 6);
    });

    it("mirrors the second series to the opposite side of the arm axis", () => {
        const arm = computeProfileLayout(request({ profileCount: 1, seriesCount: 2 })).arms[0];
        const first = bandSegment(arm, 0, 5, 0, 1);
        const second = bandSegment(arm, 0, 5, 1, 1);
        expect(first.y).toBeLessThan(0);
        expect(first.y + first.height).toBeCloseTo(0, 6);
        expect(second.y).toBe(0);
        expect(second.height).toBeGreaterThan(0);
        expect(first.x).toBe(second.x);
    });

    it("stacks panels when the arrangement asks for it", () => {
        const layout = computeProfileLayout(request({ arrangement: "stacked", profileCount: 3 }));
        expect(layout.kind).toBe("stacked");
        expect(layout.arms.map((arm) => arm.angleDegrees)).toEqual([0, 0, 0]);
        const ys = layout.arms.map((arm) => arm.origin.y);
        expect(ys[0]).toBeLessThan(ys[1]);
        expect(ys[1]).toBeLessThan(ys[2]);
    });
});

describe("text fitting", () => {
    it("returns the original text when it fits", () => {
        expect(fitText("Band 1", 200, 10)).toBe("Band 1");
    });

    it("trims to a measured budget with an ellipsis", () => {
        const trimmed = fitText("A very long band label", 40, 10);
        expect(trimmed.endsWith("\u2026")).toBe(true);
        expect(estimateTextWidth(trimmed, 10)).toBeLessThanOrEqual(40);
    });

    it("returns nothing when even the ellipsis does not fit", () => {
        expect(fitText("Band 1", 1, 10)).toBe("");
        expect(fitText("Band 1", 0, 10)).toBe("");
    });
});
