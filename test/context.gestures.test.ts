import { describe, expect, it } from "vitest";
import {
    DRAG_THRESHOLD_PX,
    dragThresholdExceeded,
    keyboardPanStep,
    normalizeWheelDelta,
    pointerDistance,
    pointerMidpoint,
    wheelZoomFactor
} from "../src/context/viewport/gestureState";

describe("context viewport gesture math", () => {
    it("uses a physical four-pixel drag threshold", () => {
        expect(DRAG_THRESHOLD_PX).toBe(4);
        expect(dragThresholdExceeded({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
        expect(dragThresholdExceeded({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
        expect(dragThresholdExceeded({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
    });

    it("normalizes pixel, line, and page wheel deltas with a bounded event cap", () => {
        expect(normalizeWheelDelta(10, 0, 600)).toBe(10);
        expect(normalizeWheelDelta(2, 1, 600)).toBe(32);
        expect(normalizeWheelDelta(1, 2, 600)).toBe(240);
        expect(normalizeWheelDelta(-1000, 0, 600)).toBe(-240);
        expect(wheelZoomFactor(-100, 1)).toBeGreaterThan(1);
        expect(wheelZoomFactor(100, 1)).toBeLessThan(1);
    });

    it("derives stable pinch midpoint and distance", () => {
        const first = { id: 1, x: 10, y: 20, pointerType: "touch" };
        const second = { id: 2, x: 30, y: 60, pointerType: "touch" };
        expect(pointerMidpoint(first, second)).toEqual({ x: 20, y: 40 });
        expect(pointerDistance(first, second)).toBeCloseTo(Math.hypot(20, 40), 12);
    });

    it("bounds keyboard pan from 80x80 through large viewports", () => {
        expect(keyboardPanStep({ width: 80, height: 80 })).toBe(16);
        expect(keyboardPanStep({ width: 400, height: 300 })).toBe(30);
        expect(keyboardPanStep({ width: 4000, height: 3000 })).toBe(64);
    });
});

