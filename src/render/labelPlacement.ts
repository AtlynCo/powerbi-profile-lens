import type { Rect } from "../layout/profileLayout";

/**
 * Deterministic label placement for the profile chart.
 *
 * The map label engine shipped earlier established the shape of this problem: sort candidates by an
 * explicit priority, walk them once, keep a list of occupied rectangles, and stop at a hard cap.
 * This is the same contract for chart labels. There is no force simulation, no relaxation pass and
 * no work after the first settle, so a probe transition costs one bounded pass and never schedules
 * anything that could run again later.
 *
 * Everything here is pure geometry so the same placement can be asserted in unit tests and then
 * re-checked against the packaged bundle in a real browser.
 */

export type LabelAlign = "start" | "middle" | "end";

export interface LabelSlot {
    readonly x: number;
    readonly y: number;
}

export interface LabelCandidate {
    readonly key: string;
    readonly text: string;
    /** Lower wins. Ties break on `order`, then on `key`, so the result is stable. */
    readonly priority: number;
    readonly order: number;
    /** Preferred position first, then bounded stagger alternatives. */
    readonly slots: readonly LabelSlot[];
    readonly width: number;
    readonly height: number;
    readonly align: LabelAlign;
    readonly fontSize: number;
    readonly kind: string;
    readonly color: string;
    readonly weight?: string;
}

export interface PlacedLabel {
    readonly key: string;
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly align: LabelAlign;
    readonly fontSize: number;
    readonly kind: string;
    readonly color: string;
    readonly weight?: string;
    readonly slot: number;
    readonly box: LabelBox;
}

export interface LabelBox {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
}

export interface PlacementOptions {
    readonly bounds: Rect;
    /** Hard ceiling on visible labels. Reached by priority order, never by input order. */
    readonly cap: number;
    readonly padding: number;
    /**
     * True when the chart renders right to left.
     *
     * `text-anchor` is direction relative, not side relative: under `dir="rtl"` a `start` anchored
     * label grows leftward from its anchor. Assuming otherwise makes every predicted box the mirror
     * image of the painted one, which silently voids the no-overlap and no-escape guarantees for
     * exactly the labels that use an edge anchor.
     */
    readonly rtl?: boolean;
}

export interface PlacementResult {
    readonly placed: readonly PlacedLabel[];
    readonly evaluated: number;
    readonly skipped: number;
    readonly cap: number;
}

/** Most stagger positions any one candidate may try, so the pass stays bounded. */
export const MAX_LABEL_SLOTS = 4;

/**
 * Visible label ceiling per density tier.
 *
 * Small tiles do not get "as many as fit": they get an explicit, documented number, so the same
 * tile always produces the same chart and a dense frame can never degrade into an unreadable run.
 */
export const LABEL_CAPS = {
    micro: 0,
    compact: 12,
    medium: 40,
    full: 160
} as const;

/**
 * Rectangle a label will occupy once painted.
 *
 * `start` and `end` are resolved against the writing direction, exactly as SVG resolves them, so
 * the predicted box is the painted box in both directions.
 */
export function labelBoxFor(
    slot: LabelSlot,
    width: number,
    height: number,
    align: LabelAlign,
    rtl = false
): LabelBox {
    const halfHeight = height / 2;
    if (align === "middle") {
        const half = width / 2;
        return {
            x1: slot.x - half,
            y1: slot.y - halfHeight,
            x2: slot.x + half,
            y2: slot.y + halfHeight
        };
    }
    const growsRight = (align === "start") !== rtl;
    return growsRight
        ? { x1: slot.x, y1: slot.y - halfHeight, x2: slot.x + width, y2: slot.y + halfHeight }
        : { x1: slot.x - width, y1: slot.y - halfHeight, x2: slot.x, y2: slot.y + halfHeight };
}

export function boxesOverlap(left: LabelBox, right: LabelBox, padding: number): boolean {
    return left.x1 < right.x2 + padding
        && left.x2 + padding > right.x1
        && left.y1 < right.y2 + padding
        && left.y2 + padding > right.y1;
}

/**
 * Places as many candidates as fit, in priority order, up to the cap.
 *
 * A candidate that cannot fit any of its slots is skipped rather than drawn on top of something
 * else. That is the whole point: a missing label is recoverable, an unreadable pile of overlapping
 * labels is not.
 */
export function placeLabels(
    candidates: readonly LabelCandidate[],
    options: PlacementOptions
): PlacementResult {
    const cap = Math.max(Math.floor(options.cap), 0);
    if (cap === 0 || candidates.length === 0) {
        return { placed: [], evaluated: 0, skipped: candidates.length, cap };
    }
    const ordered = [...candidates].sort(compareCandidates);
    const occupied: LabelBox[] = [];
    const placed: PlacedLabel[] = [];
    let evaluated = 0;
    let skipped = 0;

    for (const candidate of ordered) {
        if (placed.length >= cap) {
            skipped++;
            continue;
        }
        if (candidate.text.length === 0 || candidate.width <= 0) {
            skipped++;
            continue;
        }
        if (candidate.width > options.bounds.width || candidate.height > options.bounds.height) {
            skipped++;
            continue;
        }
        evaluated++;
        let chosen: { box: LabelBox; slot: number } | null = null;
        const slots = candidate.slots.slice(0, MAX_LABEL_SLOTS);
        for (let index = 0; index < slots.length; index++) {
            const box = clampBox(
                labelBoxFor(
                    slots[index],
                    candidate.width,
                    candidate.height,
                    candidate.align,
                    options.rtl
                ),
                options.bounds
            );
            if (occupied.some((other) => boxesOverlap(box, other, options.padding))) {
                continue;
            }
            chosen = { box, slot: index };
            break;
        }
        if (!chosen) {
            skipped++;
            continue;
        }
        occupied.push(chosen.box);
        placed.push({
            key: candidate.key,
            text: candidate.text,
            x: anchorX(chosen.box, candidate.align, options.rtl),
            y: (chosen.box.y1 + chosen.box.y2) / 2,
            align: candidate.align,
            fontSize: candidate.fontSize,
            kind: candidate.kind,
            color: candidate.color,
            weight: candidate.weight,
            slot: chosen.slot,
            box: chosen.box
        });
    }

    return { placed, evaluated, skipped, cap };
}

function compareCandidates(left: LabelCandidate, right: LabelCandidate): number {
    return left.priority - right.priority
        || left.order - right.order
        || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}

function clampBox(box: LabelBox, bounds: Rect): LabelBox {
    const width = box.x2 - box.x1;
    const height = box.y2 - box.y1;
    const x1 = Math.min(Math.max(box.x1, bounds.x), bounds.x + bounds.width - width);
    const y1 = Math.min(Math.max(box.y1, bounds.y), bounds.y + bounds.height - height);
    return { x1, y1, x2: x1 + width, y2: y1 + height };
}

/** Anchor coordinate that paints `box` for this anchor under this writing direction. */
function anchorX(box: LabelBox, align: LabelAlign, rtl = false): number {
    if (align === "middle") {
        return (box.x1 + box.x2) / 2;
    }
    const growsRight = (align === "start") !== rtl;
    return growsRight ? box.x1 : box.x2;
}
