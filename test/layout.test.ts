import { describe, expect, it } from "vitest";
import {
    LayoutRequest,
    bandLabelOffset,
    bandSegment,
    computeProfileLayout,
    densityTier,
    designScale,
    ellipseReach,
    layoutKindFor,
    maxArmReach,
    normalizeAngle
} from "../src/layout/profileLayout";
import { estimateTextWidth, fitText, isBoldWeight, wrapText } from "../src/layout/textFit";

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
            armCaptions: false,
            scaleAnnotation: false,
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
        const gutter = arm.axisGutter / 2;
        expect(gutter).toBeGreaterThan(0);
        expect(first.y).toBeLessThan(0);
        // The two series start at the gutter edge, not at the axis, so the band label has a place
        // to sit adjacent to its own band, exactly as a population pyramid carries its age scale.
        expect(first.y + first.height).toBeCloseTo(-gutter, 6);
        expect(second.y).toBeCloseTo(gutter, 6);
        expect(second.height).toBeGreaterThan(0);
        expect(first.x).toBe(second.x);
        // The gutter is taken out of the magnitude budget, never added to it.
        expect(Math.abs(first.y)).toBeLessThanOrEqual(arm.valueExtent + 1e-9);
        expect(second.y + second.height).toBeLessThanOrEqual(arm.valueExtent + 1e-9);
    });

    it("keeps an unmirrored arm free of a gutter so labels sit against the baseline", () => {
        const arm = computeProfileLayout(request({ profileCount: 3, seriesCount: 1 })).arms[0];
        expect(arm.axisGutter).toBe(0);
        expect(bandLabelOffset(arm, 10)).toBeGreaterThan(0);
        const segment = bandSegment(arm, 0, 5, 0, 1);
        expect(segment.y).toBeCloseTo(-arm.valueExtent, 6);
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

describe("chart box usage", () => {
    it("spends the whole width of a wide tile on a single axis", () => {
        const layout = computeProfileLayout(request({
            viewport: { width: 1520, height: 560 },
            profileCount: 1,
            seriesCount: 2
        }));
        const arm = layout.arms[0];
        // Before this pass the band axis was capped by the inscribed circle, so a 1520 wide tile
        // used roughly a 560 wide square of itself and left the rest blank.
        expect(arm.bandExtent).toBeGreaterThan(layout.chart.width * 0.85);
        expect(arm.bandStart + arm.bandExtent).toBeLessThanOrEqual(layout.chart.width / 2 + 0.001);
    });

    it("centres a single-series bilateral band instead of leaving the lower half empty", () => {
        const layout = computeProfileLayout(request({
            viewport: { width: 1520, height: 560 },
            profileCount: 1,
            seriesCount: 1
        }));
        const arm = layout.arms[0];
        const full = bandSegment(arm, 0, 5, 0, 1);
        const top = arm.origin.y + full.y;
        const baseline = arm.origin.y;
        expect(baseline).toBeGreaterThan(layout.center.y);
        expect(top).toBeLessThan(layout.center.y);
        // The drawn band straddles the centre of the chart box rather than hugging its top half.
        expect(Math.abs((top + baseline) / 2 - layout.center.y)).toBeLessThan(2);
        expect(top).toBeGreaterThanOrEqual(layout.chart.y - 0.001);
        expect(baseline).toBeLessThanOrEqual(layout.chart.y + layout.chart.height + 0.001);
    });

    it("lets radial arms reach further along the long side of a wide tile", () => {
        const wide = computeProfileLayout(request({
            viewport: { width: 1520, height: 560 },
            profileCount: 4
        }));
        const horizontal = wide.arms.find((arm) => arm.angleDegrees === 0)!;
        const vertical = wide.arms.find((arm) => arm.angleDegrees === 90)!;
        expect(horizontal.bandExtent).toBeGreaterThan(vertical.bandExtent);
        for (const arm of wide.arms) {
            const radians = (arm.angleDegrees * Math.PI) / 180;
            const tipX = Math.abs(Math.cos(radians)) * (arm.bandStart + arm.bandExtent)
                + Math.abs(Math.sin(radians)) * arm.valueExtent;
            const tipY = Math.abs(Math.sin(radians)) * (arm.bandStart + arm.bandExtent)
                + Math.abs(Math.cos(radians)) * arm.valueExtent;
            expect(tipX).toBeLessThanOrEqual(wide.chart.width / 2 + 0.001);
            expect(tipY).toBeLessThanOrEqual(wide.chart.height / 2 + 0.001);
        }
    });

    it("keeps arm proportions stable as the tile shrinks", () => {
        const sizes = [
            { width: 1280, height: 620 },
            { width: 640, height: 460 },
            { width: 490, height: 390 }
        ];
        const ratios = sizes.map((viewport) => {
            const layout = computeProfileLayout(request({ viewport, profileCount: 3 }));
            const arm = layout.arms[0];
            return arm.bandThickness / (arm.bandExtent / layout.bandCount);
        });
        for (let index = 1; index < ratios.length; index++) {
            expect(Math.abs(ratios[index] - ratios[0])).toBeLessThan(0.2);
        }
        expect(designScale({ width: 1280, height: 620 })).toBe(1);
        expect(designScale({ width: 490, height: 390 })).toBeLessThan(1);
        expect(designScale({ width: 80, height: 80 })).toBeGreaterThanOrEqual(0.45);
    });

    it("derives label type from the design scale and never below the legible floor", () => {
        expect(computeProfileLayout(request({ requestedFontSize: 10 })).labelFontSize).toBe(10);
        const small = computeProfileLayout(request({
            viewport: { width: 490, height: 390 },
            requestedFontSize: 10
        }));
        expect(small.labelFontSize).toBeLessThan(10);
        expect(small.labelFontSize).toBeGreaterThanOrEqual(7);
    });

    it("solves the oriented fit exactly at the axis-aligned angles", () => {
        expect(ellipseReach(300, 100, 0)).toBeCloseTo(300, 6);
        expect(ellipseReach(300, 100, 90)).toBeCloseTo(100, 6);
        expect(maxArmReach(300, 100, 0, 40)).toBeCloseTo(300, 6);
        expect(maxArmReach(300, 100, 90, 40)).toBeCloseTo(100, 6);
        expect(maxArmReach(300, 100, 45, 20)).toBeCloseTo((100 - 20 * Math.SQRT1_2) / Math.SQRT1_2, 6);
    });
});

describe("lens containment", () => {
    const lensRequest = (overrides: Partial<LayoutRequest> = {}): LayoutRequest =>
        request({ lensContainment: true, ...overrides });

    it("stays inert unless the composition asks for it", () => {
        expect(computeProfileLayout(request()).lens).toBeNull();
        expect(computeProfileLayout(lensRequest()).lens).not.toBeNull();
        expect(computeProfileLayout(lensRequest({ arrangement: "stacked" })).lens).toBeNull();
    });

    it("puts the aperture on the fixed centre probe and covers the whole surface", () => {
        const layout = computeProfileLayout(lensRequest());
        const lens = layout.lens!;
        expect(lens.center).toEqual(layout.center);
        expect(lens.apertureRadius).toBeGreaterThan(0);
        expect(lens.apertureRadius).toBeLessThan(layout.radius);
        expect(lens.scrim.x).toBeLessThan(layout.chart.x);
        expect(lens.scrim.y).toBeLessThan(layout.chart.y);
        expect(lens.scrim.x + lens.scrim.width)
            .toBeGreaterThan(layout.chart.x + layout.chart.width);
        expect(lens.scrim.y + lens.scrim.height)
            .toBeGreaterThan(layout.chart.y + layout.chart.height);
    });

    it("anchors every arm outside the aperture", () => {
        for (const profileCount of [1, 2, 3, 4, 6]) {
            const layout = computeProfileLayout(lensRequest({ profileCount }));
            const lens = layout.lens!;
            for (const arm of layout.arms) {
                expect(arm.bandStart, `profileCount ${profileCount}`)
                    .toBeGreaterThan(lens.apertureRadius);
                expect(arm.bandExtent).toBeGreaterThan(0);
            }
        }
    });

    it("keeps the aperture and arms inside an 80x80 tile", () => {
        const layout = computeProfileLayout(lensRequest({ viewport: { width: 80, height: 80 } }));
        const lens = layout.lens!;
        expect(lens.apertureRadius).toBeLessThan(layout.radius);
        for (const arm of layout.arms) {
            expect(arm.bandStart).toBeGreaterThan(lens.apertureRadius);
            expect(arm.valueExtent).toBeGreaterThan(0);
            expect(arm.bandThickness).toBeGreaterThan(0);
        }
    });
});

describe("text fitting", () => {
    it("returns the original text when it fits", () => {
        expect(fitText("Band 1", 200, 10)).toBe("Band 1");
    });

    it("measures bold runs wider, because that is how they paint", () => {
        // A caption measured at regular weight but painted semibold reserves a box narrower than
        // its own glyphs, which is a silent overlap in any collision engine downstream.
        expect(isBoldWeight("600")).toBe(true);
        expect(isBoldWeight("bold")).toBe(true);
        expect(isBoldWeight("400")).toBe(false);
        expect(isBoldWeight(undefined)).toBe(false);
        const regular = estimateTextWidth("Degree attainment rate", 10);
        const bold = estimateTextWidth("Degree attainment rate", 10, "600");
        expect(bold).toBeGreaterThan(regular);
        expect(estimateTextWidth("Band 1", 10, "400")).toBe(estimateTextWidth("Band 1", 10));
    });

    it("passes the weight through fitText and wrapText", () => {
        const seen: Array<string | undefined> = [];
        const measure = (text: string, size: number, weight?: string): number => {
            seen.push(weight);
            return estimateTextWidth(text, size, weight);
        };
        fitText("A very long caption that will not fit", 40, 10, measure, "600");
        wrapText("A very long message that wraps onto lines", 40, 10, 2, measure, "600");
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((weight) => weight === "600")).toBe(true);
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
