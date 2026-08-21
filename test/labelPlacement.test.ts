import { describe, expect, it } from "vitest";
import {
    LABEL_CAPS,
    LabelCandidate,
    MAX_LABEL_SLOTS,
    boxesOverlap,
    labelBoxFor,
    placeLabels
} from "../src/render/labelPlacement";
import {
    MIN_SERIES_LUMINANCE_SEPARATION,
    separateSeriesFills,
    shiftLightness
} from "../src/render/theme";

const bounds = { x: 0, y: 0, width: 400, height: 300 };

function candidate(overrides: Partial<LabelCandidate> = {}): LabelCandidate {
    return {
        key: "k",
        text: "Band 1",
        priority: 2,
        order: 0,
        slots: [{ x: 200, y: 150 }],
        width: 40,
        height: 12,
        align: "middle",
        fontSize: 10,
        kind: "band",
        color: "#252423",
        ...overrides
    };
}

describe("label placement", () => {
    it("never lets two placed labels overlap", () => {
        // Five labels asking for the same point, which is what produced the unreadable
        // "Band 5Band 4Band 3Band 2Band 1" run on the 490x390 normalization tile.
        const candidates = [0, 1, 2, 3, 4].map((index) => candidate({
            key: `band:${index}`,
            text: `Band ${index + 1}`,
            order: index,
            slots: [{ x: 200, y: 150 }]
        }));
        const result = placeLabels(candidates, { bounds, cap: 100, padding: 1 });
        expect(result.placed).toHaveLength(1);
        expect(result.skipped).toBe(4);
        for (let left = 0; left < result.placed.length; left++) {
            for (let right = left + 1; right < result.placed.length; right++) {
                expect(boxesOverlap(result.placed[left].box, result.placed[right].box, 0)).toBe(false);
            }
        }
    });

    it("falls back to a stagger slot before skipping", () => {
        const first = candidate({ key: "a", order: 0, slots: [{ x: 200, y: 150 }] });
        const second = candidate({
            key: "b",
            order: 1,
            slots: [{ x: 200, y: 150 }, { x: 200, y: 200 }]
        });
        const result = placeLabels([first, second], { bounds, cap: 100, padding: 1 });
        expect(result.placed.map((label) => label.key)).toEqual(["a", "b"]);
        expect(result.placed[1].slot).toBe(1);
        expect(result.placed[1].y).toBeCloseTo(200, 6);
    });

    it("resolves collisions by priority, not by input order", () => {
        const value = candidate({ key: "value", priority: 3, order: 0 });
        const band = candidate({ key: "band", priority: 2, order: 9 });
        const caption = candidate({ key: "caption", priority: 0, order: 9 });
        const result = placeLabels([value, band, caption], { bounds, cap: 100, padding: 1 });
        expect(result.placed.map((label) => label.key)).toEqual(["caption"]);
    });

    it("is deterministic for the same input regardless of enumeration order", () => {
        const candidates = [3, 1, 4, 2, 0].map((index) => candidate({
            key: `band:${index}`,
            order: index,
            slots: [{ x: 40 + index * 70, y: 150 }]
        }));
        const forward = placeLabels(candidates, { bounds, cap: 100, padding: 1 });
        const reversed = placeLabels([...candidates].reverse(), { bounds, cap: 100, padding: 1 });
        expect(forward.placed.map((label) => label.key))
            .toEqual(reversed.placed.map((label) => label.key));
        expect(forward.placed.map((label) => label.x))
            .toEqual(reversed.placed.map((label) => label.x));
    });

    it("honours an explicit visible cap in priority order", () => {
        const candidates = [0, 1, 2, 3, 4].map((index) => candidate({
            key: `band:${index}`,
            order: index,
            slots: [{ x: 40 + index * 70, y: 150 }]
        }));
        const result = placeLabels(candidates, { bounds, cap: 3, padding: 1 });
        expect(result.placed.map((label) => label.key))
            .toEqual(["band:0", "band:1", "band:2"]);
        expect(result.cap).toBe(3);
        expect(result.skipped).toBe(2);
    });

    it("places nothing at the micro tier cap", () => {
        expect(LABEL_CAPS.micro).toBe(0);
        const result = placeLabels([candidate()], { bounds, cap: LABEL_CAPS.micro, padding: 1 });
        expect(result.placed).toHaveLength(0);
    });

    it("caps the work per candidate so the pass stays bounded", () => {
        const many = candidate({
            slots: Array.from({ length: 40 }, (_unused, index) => ({ x: 10 + index, y: 150 }))
        });
        const blocker = candidate({ key: "blocker", priority: 0, slots: [{ x: 200, y: 150 }] });
        const result = placeLabels([blocker, many], { bounds, cap: 100, padding: 1 });
        expect(MAX_LABEL_SLOTS).toBe(4);
        expect(result.placed.every((label) => label.slot < MAX_LABEL_SLOTS)).toBe(true);
    });

    it("clamps a label into the chart box rather than letting it escape", () => {
        const result = placeLabels(
            [candidate({ slots: [{ x: -80, y: -40 }] })],
            { bounds, cap: 10, padding: 0 }
        );
        expect(result.placed).toHaveLength(1);
        const box = result.placed[0].box;
        expect(box.x1).toBeGreaterThanOrEqual(bounds.x);
        expect(box.y1).toBeGreaterThanOrEqual(bounds.y);
        expect(box.x2).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(box.y2).toBeLessThanOrEqual(bounds.y + bounds.height);
    });

    it("skips a label that cannot fit the chart box at all", () => {
        const result = placeLabels(
            [candidate({ width: bounds.width + 20 })],
            { bounds, cap: 10, padding: 0 }
        );
        expect(result.placed).toHaveLength(0);
        expect(result.skipped).toBe(1);
    });

    it("builds boxes that match the text anchor", () => {
        expect(labelBoxFor({ x: 100, y: 50 }, 40, 12, "middle"))
            .toEqual({ x1: 80, y1: 44, x2: 120, y2: 56 });
        expect(labelBoxFor({ x: 100, y: 50 }, 40, 12, "start"))
            .toEqual({ x1: 100, y1: 44, x2: 140, y2: 56 });
        expect(labelBoxFor({ x: 100, y: 50 }, 40, 12, "end"))
            .toEqual({ x1: 60, y1: 44, x2: 100, y2: 56 });
    });
});

describe("series differentiation", () => {
    it("separates two series by lightness, not only by hue", () => {
        const [primary, secondary] = separateSeriesFills("#118DFF", "#E66C37", false);
        expect(primary).toBe("#118DFF");
        expect(luminance(secondary)).not.toBeCloseTo(luminance(primary), 2);
        expect(Math.abs(luminance(secondary) - luminance(primary)))
            .toBeGreaterThanOrEqual(MIN_SERIES_LUMINANCE_SEPARATION);
    });

    it("steps a colliding secondary away until the gap is met", () => {
        // Two colours a red/green deficiency renders almost identically.
        const [primary, secondary] = separateSeriesFills("#118DFF", "#1191FF", false);
        expect(secondary).not.toBe("#1191FF");
        expect(Math.abs(luminance(secondary) - luminance(primary)))
            .toBeGreaterThanOrEqual(MIN_SERIES_LUMINANCE_SEPARATION);
    });

    it("honours an author palette that already separates", () => {
        expect(separateSeriesFills("#000000", "#FFFFFF", false)).toEqual(["#000000", "#FFFFFF"]);
    });

    it("shifts lightness toward white and black without leaving the range", () => {
        expect(shiftLightness("#808080", 1)).toBe("#FFFFFF");
        expect(shiftLightness("#808080", -1)).toBe("#000000");
        expect(shiftLightness("not a colour", 0.5)).toBe("not a colour");
    });
});

function luminance(color: string): number {
    const channels = [1, 3, 5].map((offset) =>
        Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map((value) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
