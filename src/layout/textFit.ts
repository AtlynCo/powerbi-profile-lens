/**
 * Measures text as it will actually be painted.
 *
 * Weight is part of the signature because it changes the advance width: a semibold caption is a few
 * percent wider than the same string at regular weight. Measuring without it makes a collision
 * engine reserve a box narrower than the glyphs, which is a silent overlap.
 */
export type TextMeasurer = (text: string, fontSizePx: number, fontWeight?: string) => number;

const ELLIPSIS = "\u2026";
/** Advance-width premium of a bold run over the same string at regular weight. */
const BOLD_WIDTH_FACTOR = 1.05;

export function isBoldWeight(fontWeight?: string): boolean {
    if (!fontWeight) {
        return false;
    }
    if (fontWeight === "bold" || fontWeight === "bolder") {
        return true;
    }
    const numeric = Number(fontWeight);
    return Number.isFinite(numeric) && numeric >= 600;
}

/** Deterministic fallback measurement used when the browser cannot measure SVG text. */
export const estimateTextWidth: TextMeasurer = (text, fontSizePx, fontWeight) =>
    text.length * fontSizePx * 0.55 * (isBoldWeight(fontWeight) ? BOLD_WIDTH_FACTOR : 1);

/**
 * Trims text to a measured pixel budget instead of relying on CSS ellipsis, so labels never escape
 * the visual root and the same string always produces the same trimmed result.
 */
export function fitText(
    text: string,
    maxWidth: number,
    fontSizePx: number,
    measure: TextMeasurer = estimateTextWidth,
    fontWeight?: string
): string {
    if (text.length === 0 || maxWidth <= 0) {
        return "";
    }
    if (measure(text, fontSizePx, fontWeight) <= maxWidth) {
        return text;
    }
    if (measure(ELLIPSIS, fontSizePx, fontWeight) > maxWidth) {
        return "";
    }
    let low = 0;
    let high = text.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = `${text.slice(0, middle)}${ELLIPSIS}`;
        if (measure(candidate, fontSizePx, fontWeight) <= maxWidth) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return low <= 0 ? ELLIPSIS : `${text.slice(0, low)}${ELLIPSIS}`;
}

/**
 * Wraps text onto at most maxLines measured lines.
 *
 * Words that cannot fit on their own are trimmed by fitText, and any remainder that exceeds the
 * line budget is folded into the last line so nothing is silently dropped without an ellipsis.
 */
export function wrapText(
    text: string,
    maxWidth: number,
    fontSizePx: number,
    maxLines: number,
    measure: TextMeasurer = estimateTextWidth,
    fontWeight?: string
): readonly string[] {
    const words = text.split(/\s+/u).filter((word) => word.length > 0);
    if (words.length === 0 || maxWidth <= 0 || maxLines <= 0) {
        return [];
    }
    const lines: string[] = [];
    let current = "";
    for (let index = 0; index < words.length; index++) {
        const word = words[index];
        const candidate = current.length === 0 ? word : `${current} ${word}`;
        if (measure(candidate, fontSizePx, fontWeight) <= maxWidth || current.length === 0) {
            current = candidate;
            continue;
        }
        lines.push(current);
        if (lines.length === maxLines - 1) {
            current = words.slice(index).join(" ");
            break;
        }
        current = word;
    }
    if (current.length > 0) {
        lines.push(current);
    }
    return lines
        .slice(0, maxLines)
        .map((line) => fitText(line, maxWidth, fontSizePx, measure, fontWeight))
        .filter((line) => line.length > 0);
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

    return (text, fontSizePx, fontWeight) => {
        const weight = fontWeight ?? "";
        // Weight belongs in the key as well as on the probe, or the first measurement of a string
        // would be reused for every later weight of that same string.
        const key = `${fontSizePx}:${weight}:${text}`;
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
            if (weight.length > 0) {
                probe.setAttribute("font-weight", weight);
            } else {
                probe.removeAttribute("font-weight");
            }
            probe.textContent = text;
            width = probe.getComputedTextLength();
            if (!Number.isFinite(width) || width <= 0) {
                width = estimateTextWidth(text, fontSizePx, fontWeight);
            }
        } else {
            width = estimateTextWidth(text, fontSizePx, fontWeight);
        }
        cache.set(key, width);
        return width;
    };
}
