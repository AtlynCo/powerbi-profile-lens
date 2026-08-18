import { LIMITS } from "../model/contract";
import type { DetailDecision, DetailObservation, DetailStrategy, DetailStrategyId } from "./contract";

function decision(
    strategyId: DetailStrategyId,
    state: DetailDecision["state"],
    requestMore: boolean,
    reason: string
): DetailDecision {
    return { strategyId, state, requestMore, reason };
}

export class EagerDetailStrategy implements DetailStrategy {
    public readonly id = "eager";

    public evaluate(): DetailDecision {
        return decision(this.id, "ready", false, "The current DataView is treated as complete.");
    }
}

export class SegmentedDetailStrategy implements DetailStrategy {
    public readonly id = "segmented";

    public evaluate(observation: DetailObservation): DetailDecision {
        const partial = Boolean(observation.dataView?.metadata?.segment);
        if (!partial) {
            return decision(this.id, "ready", false, "No segment marker is present.");
        }
        const canRequest = observation.model.segments.requests < LIMITS.maxSegmentRequests;
        return decision(
            this.id,
            canRequest ? "loading" : "partial",
            canRequest,
            canRequest ? "Another bounded segment is available." : "The segment request budget is exhausted."
        );
    }
}

export class ExternalDetailStrategy implements DetailStrategy {
    public readonly id = "external";

    public evaluate(): DetailDecision {
        return decision(this.id, "ready", false, "The report filter context is authoritative.");
    }
}

export class MatrixExpandDetailStrategy implements DetailStrategy {
    public readonly id = "matrixExpand";

    public evaluate(): DetailDecision {
        return decision(
            this.id,
            "unavailable",
            false,
            "Native expand/collapse is disabled until the documented Power BI host proof passes."
        );
    }
}

export class AutoDetailStrategy implements DetailStrategy {
    public readonly id = "auto";

    public evaluate(observation: DetailObservation): DetailDecision {
        if (observation.dataView?.metadata?.segment) {
            return new SegmentedDetailStrategy().evaluate(observation);
        }
        return decision("eager", "ready", false, "Auto selected eager loading for the observed DataView.");
    }
}

export function createDefaultDetailStrategies(): readonly DetailStrategy[] {
    return [
        new AutoDetailStrategy(),
        new EagerDetailStrategy(),
        new SegmentedDetailStrategy(),
        new MatrixExpandDetailStrategy(),
        new ExternalDetailStrategy()
    ];
}
