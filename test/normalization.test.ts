import { describe, expect, it } from "vitest";
import { IMPLICIT_INDEX, ProfileCell } from "../src/model/contract";
import {
    formatDisplayValue,
    isProportionalMode,
    normalizeFrame,
    selectFrameCells
} from "../src/model/normalization";

function cell(
    bandIndex: number,
    value: number | null,
    seriesIndex = IMPLICIT_INDEX,
    profileIndex = 0
): ProfileCell {
    return {
        entityIndex: 0,
        periodIndex: IMPLICIT_INDEX,
        bandIndex,
        seriesIndex,
        profileIndex,
        value,
        state: value === null ? "missing" : "value",
        highlight: null,
        hasHighlight: false
    };
}

const settings = {
    mode: "raw" as const,
    percentScale: "fraction" as const,
    blankPolicy: "missing" as const
};

describe("normalization", () => {
    it("returns the bound value in raw mode", () => {
        const frame = normalizeFrame([cell(0, 10), cell(1, 30)], [0], settings, false);
        expect(frame.profiles[0].cells.map((entry) => entry.display)).toEqual([10, 30]);
        expect(frame.profiles[0].axisMaximum).toBe(30);
        expect(frame.isProportional).toBe(false);
    });

    it("divides by the profile total in share of profile mode", () => {
        const frame = normalizeFrame(
            [cell(0, 10, 0), cell(1, 30, 0), cell(0, 10, 1), cell(1, 50, 1)],
            [0],
            { ...settings, mode: "shareOfProfile" },
            false
        );
        const displays = frame.profiles[0].cells.map((entry) => entry.display);
        expect(displays).toEqual([0.1, 0.3, 0.1, 0.5]);
        expect(frame.isProportional).toBe(true);
    });

    it("divides by the series total in share within series mode", () => {
        const frame = normalizeFrame(
            [cell(0, 10, 0), cell(1, 30, 0), cell(0, 10, 1), cell(1, 50, 1)],
            [0],
            { ...settings, mode: "shareWithinSeries" },
            false
        );
        expect(frame.profiles[0].cells.map((entry) => entry.display)).toEqual([
            0.25,
            0.75,
            10 / 60,
            50 / 60
        ]);
    });

    it("divides by the profile maximum in index to maximum mode", () => {
        const frame = normalizeFrame(
            [cell(0, 20), cell(1, 40)],
            [0],
            { ...settings, mode: "indexToMaximum" },
            false
        );
        expect(frame.profiles[0].cells.map((entry) => entry.display)).toEqual([0.5, 1]);
    });

    it("respects the bound percentage scale in already percent mode", () => {
        const fraction = normalizeFrame(
            [cell(0, 0.25)],
            [0],
            { ...settings, mode: "alreadyPercent", percentScale: "fraction" },
            false
        );
        const percent = normalizeFrame(
            [cell(0, 25)],
            [0],
            { ...settings, mode: "alreadyPercent", percentScale: "percent" },
            false
        );
        expect(fraction.profiles[0].cells[0].display).toBe(0.25);
        expect(percent.profiles[0].cells[0].display).toBe(0.25);
    });

    it("marks a zero denominator instead of inventing a value", () => {
        const frame = normalizeFrame(
            [cell(0, 0), cell(1, 0)],
            [0],
            { ...settings, mode: "shareOfProfile" },
            false
        );
        expect(frame.profiles[0].cells.map((entry) => entry.state)).toEqual([
            "zeroDenominator",
            "zeroDenominator"
        ]);
        expect(frame.profiles[0].cells.every((entry) => entry.display === null)).toBe(true);
        expect(frame.zeroDenominatorCount).toBe(2);
    });

    it("keeps missing values missing unless the blank policy says otherwise", () => {
        const asMissing = normalizeFrame([cell(0, null), cell(1, 10)], [0], settings, false);
        expect(asMissing.profiles[0].cells[0].state).toBe("missing");
        expect(asMissing.missingCount).toBe(1);

        const asZero = normalizeFrame(
            [cell(0, null), cell(1, 10)],
            [0],
            { ...settings, blankPolicy: "zero" },
            false
        );
        expect(asZero.profiles[0].cells[0].display).toBe(0);
        expect(asZero.missingCount).toBe(0);
    });

    it("dims cells that are not highlighted when highlighting is active", () => {
        const highlighted: ProfileCell = {
            ...cell(0, 10),
            highlight: 10,
            hasHighlight: true
        };
        const unhighlighted: ProfileCell = {
            ...cell(1, 20),
            highlight: null,
            hasHighlight: true
        };
        const frame = normalizeFrame([highlighted, unhighlighted], [0], settings, true);
        expect(frame.profiles[0].cells[0]).toMatchObject({ highlighted: true, dimmed: false });
        expect(frame.profiles[0].cells[1]).toMatchObject({ highlighted: false, dimmed: true });
    });

    it("selects only the requested entity and period frame", () => {
        const cells: ProfileCell[] = [
            cell(0, 1),
            { ...cell(0, 2), entityIndex: 1 },
            { ...cell(0, 3), periodIndex: 1 }
        ];
        const frame = selectFrameCells(cells, { entityIndex: 0, periodIndex: IMPLICIT_INDEX });
        expect(frame).toHaveLength(1);
        expect(frame[0].value).toBe(1);
    });

    it("formats proportional modes as percentages and raw mode as numbers", () => {
        expect(isProportionalMode("shareOfProfile")).toBe(true);
        expect(formatDisplayValue(0.256, "shareOfProfile", "en-US")).toBe("25.6%");
        expect(formatDisplayValue(1234.5, "raw", "en-US")).toBe("1,234.5");
        expect(formatDisplayValue(null, "raw", "en-US")).toBe("");
    });
});
