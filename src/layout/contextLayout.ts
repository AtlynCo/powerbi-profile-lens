import type { Rect, Size } from "./profileLayout";

export type ContextLayoutMode = "split" | "focusLens" | "locatorInset" | "profileOnly";

export interface ContextLayout {
    readonly requestedMode: ContextLayoutMode;
    readonly effectiveMode: ContextLayoutMode;
    readonly context: Rect | null;
    readonly profile: Rect;
}

const MIN_FOCUS_SIDE = 420;
const MIN_SPLIT_WIDTH = 320;
const MIN_CONTEXT_SIDE = 96;

export function computeContextLayout(
    viewport: Size,
    requestedMode: ContextLayoutMode,
    hasContext: boolean,
    rtl: boolean
): ContextLayout {
    const full: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
    if (!hasContext || requestedMode === "profileOnly" || Math.min(viewport.width, viewport.height) < 130) {
        return { requestedMode, effectiveMode: "profileOnly", context: null, profile: full };
    }
    let effectiveMode = requestedMode;
    if (effectiveMode === "focusLens" && Math.min(viewport.width, viewport.height) < MIN_FOCUS_SIDE) {
        effectiveMode = viewport.width >= MIN_SPLIT_WIDTH ? "split" : "locatorInset";
    }
    if (effectiveMode === "split" && viewport.width < MIN_SPLIT_WIDTH) {
        effectiveMode = "locatorInset";
    }
    if (effectiveMode === "split") {
        const contextWidth = Math.max(Math.floor(viewport.width * 0.42), MIN_CONTEXT_SIDE);
        const contextX = rtl ? viewport.width - contextWidth : 0;
        const profileX = rtl ? 0 : contextWidth;
        return {
            requestedMode,
            effectiveMode,
            context: { x: contextX, y: 0, width: contextWidth, height: viewport.height },
            profile: { x: profileX, y: 0, width: viewport.width - contextWidth, height: viewport.height }
        };
    }
    if (effectiveMode === "locatorInset") {
        const side = Math.max(Math.min(Math.floor(Math.min(viewport.width, viewport.height) * 0.34), 180), 72);
        return {
            requestedMode,
            effectiveMode,
            context: { x: rtl ? 4 : viewport.width - side - 4, y: 4, width: side, height: side },
            profile: full
        };
    }
    return {
        requestedMode,
        effectiveMode: "focusLens",
        context: full,
        profile: full
    };
}
