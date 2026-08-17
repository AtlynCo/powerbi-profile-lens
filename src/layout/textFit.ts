export type TextMeasurer = (text: string, fontSizePx: number) => number;

const ELLIPSIS = "\u2026";

/** Deterministic fallback measurement used when the browser cannot measure SVG text. */
export const estimateTextWidth: TextMeasurer = (text, fontSizePx) =>
    text.length * fontSizePx * 0.55;

/**
 * Trims text to a measured pixel budget instead of relying on CSS ellipsis, so labels never escape
 * the visual root and the same string always produces the same trimmed result.
 */
export function fitText(
    text: string,
    maxWidth: number,
    fontSizePx: number,
    measure: TextMeasurer = estimateTextWidth
): string {
    if (text.length === 0 || maxWidth <= 0) {
        return "";
    }
    if (measure(text, fontSizePx) <= maxWidth) {
        return text;
    }
    if (measure(ELLIPSIS, fontSizePx) > maxWidth) {
        return "";
    }
    let low = 0;
    let high = text.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = `${text.slice(0, middle)}${ELLIPSIS}`;
        if (measure(candidate, fontSizePx) <= maxWidth) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return low <= 0 ? ELLIPSIS : `${text.slice(0, low)}${ELLIPSIS}`;
}

/**
 * Creates a measurer backed by the browser's SVG text metrics, with a cache and a deterministic
 * fallback for environments that do not implement getComputedTextLength.
 */
export function createSvgTextMeasurer(svg: SVGSVGElement): TextMeasurer {
    const cache = new Map<string, number>();
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
    probe.setAttribute("visibility", "hidden");
    probe.setAttribute("transform", "scale(0)");
    probe.setAttribute("aria-hidden", "true");
    svg.appendChild(probe);

    return (text, fontSizePx) => {
        const key = `${fontSizePx}:${text}`;
        const cached = cache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        if (probe.parentNode !== svg) {
            svg.appendChild(probe);
        }
        let width: number;
        if (typeof probe.getComputedTextLength === "function") {
            probe.setAttribute("font-size", `${fontSizePx}px`);
            probe.textContent = text;
            width = probe.getComputedTextLength();
            if (!Number.isFinite(width) || width <= 0) {
                width = estimateTextWidth(text, fontSizePx);
            }
        } else {
            width = estimateTextWidth(text, fontSizePx);
        }
        cache.set(key, width);
        return width;
    };
}
