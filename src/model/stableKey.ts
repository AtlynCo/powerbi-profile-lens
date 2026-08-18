/**
 * Locale-independent lexicographic ordering over JavaScript UTF-16 code units.
 *
 * Stable keys are opaque identifiers, not display text, so locale collation must never affect
 * placement, focus tie-breaking, package probes, or bookmark restoration.
 */
export function compareStableKeys(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}
