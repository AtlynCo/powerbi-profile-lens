import type { ContextFeature, SceneTransform } from "../context/contract";
import { projectedCenter } from "../context/projection";
import { compareStableKeys } from "../model/stableKey";

export type SpatialDirection = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export function spatialNeighbor(
    features: readonly ContextFeature[],
    currentKey: string | null,
    direction: SpatialDirection,
    transform: SceneTransform,
    rtl: boolean
): ContextFeature | null {
    if (features.length === 0) {
        return null;
    }
    const normalizedDirection = rtl && direction === "ArrowLeft"
        ? "ArrowRight"
        : rtl && direction === "ArrowRight"
            ? "ArrowLeft"
            : direction;
    const current = features.find((feature) => `context:${feature.key}` === currentKey) ?? features[0];
    const origin = projectedCenter(current, transform);
    const candidates = features
        .filter((feature) => feature !== current)
        .map((feature) => {
            const point = projectedCenter(feature, transform);
            const dx = point.x - origin.x;
            const dy = point.y - origin.y;
            const directional = normalizedDirection === "ArrowLeft" ? dx < 0
                : normalizedDirection === "ArrowRight" ? dx > 0
                    : normalizedDirection === "ArrowUp" ? dy < 0
                        : dy > 0;
            const forward = normalizedDirection === "ArrowLeft" || normalizedDirection === "ArrowRight"
                ? Math.abs(dx)
                : Math.abs(dy);
            const cross = normalizedDirection === "ArrowLeft" || normalizedDirection === "ArrowRight"
                ? Math.abs(dy)
                : Math.abs(dx);
            return { feature, directional, score: forward + cross * 2 };
        })
        .filter((candidate) => candidate.directional)
        .sort((left, right) =>
            left.score - right.score || compareStableKeys(left.feature.key, right.feature.key));
    return candidates[0]?.feature ?? current;
}
