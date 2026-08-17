import powerbi from "powerbi-visuals-api";
import { Diagnostic, LIMITS, ProfileDataModel, SegmentState } from "./contract";
import { compareDiagnostics, messageKeyFor, severityOf } from "./diagnostics";

type VisualDataChangeOperationKind = powerbi.VisualDataChangeOperationKind;

/**
 * Bounded segment accounting.
 *
 * The host may deliver a matrix in segments. Accumulation is capped, and both the partial state and
 * the cap are surfaced as diagnostics so a truncated result is never presented as a complete one.
 */
export class SegmentTracker {
    private requests = 0;
    private fingerprint: string | null = null;

    public constructor(private readonly maxRequests: number = LIMITS.maxSegmentRequests) {}

    /** Registers an update. Resets the counter when the query shape changed. */
    public register(fingerprint: string, operationKind: VisualDataChangeOperationKind | undefined): void {
        const isAppend = operationKind === 1; /* VisualDataChangeOperationKind.Append */
        if (!isAppend || this.fingerprint === null || this.fingerprint !== fingerprint) {
            this.requests = isAppend ? this.requests + 1 : 1;
        } else {
            this.requests++;
        }
        this.fingerprint = fingerprint;
    }

    public reset(): void {
        this.requests = 0;
        this.fingerprint = null;
    }

    public canRequestMore(): boolean {
        return this.requests < this.maxRequests;
    }

    public state(moreDataAvailable: boolean): SegmentState {
        return {
            requests: this.requests,
            maxRequests: this.maxRequests,
            moreDataAvailable,
            partial: moreDataAvailable
        };
    }
}

export function withSegmentState(
    model: ProfileDataModel,
    state: SegmentState
): ProfileDataModel {
    const additions: Diagnostic[] = [];
    if (state.partial) {
        additions.push(diagnostic("partialData", {
            received: state.requests,
            retained: model.counts.retained
        }));
    }
    if (state.moreDataAvailable && state.requests >= state.maxRequests) {
        additions.push(diagnostic("segmentLimitReached", {
            received: state.requests,
            retained: state.maxRequests
        }));
    }
    return {
        ...model,
        segments: state,
        diagnostics: mergeDiagnostics(model.diagnostics, additions)
    };
}

export function mergeDiagnostics(
    existing: readonly Diagnostic[],
    additions: readonly Diagnostic[]
): readonly Diagnostic[] {
    const byCode = new Map<string, Diagnostic>();
    for (const entry of existing) {
        byCode.set(entry.code, entry);
    }
    for (const entry of additions) {
        byCode.set(entry.code, entry);
    }
    return [...byCode.values()].sort(compareDiagnostics);
}

function diagnostic(
    code: Diagnostic["code"],
    counts: { received?: number; retained?: number }
): Diagnostic {
    return {
        code,
        severity: severityOf(code),
        messageKey: messageKeyFor(code),
        ...counts
    };
}
