import type powerbi from "powerbi-visuals-api";
import type { ProfileDataModel } from "../model/contract";

export type DetailStrategyId = "auto" | "eager" | "segmented" | "matrixExpand" | "external";
export type DetailLoadState = "ready" | "loading" | "partial" | "unavailable";

export interface DetailObservation {
    readonly model: ProfileDataModel;
    readonly dataView: powerbi.DataView | undefined;
    readonly operationKind: powerbi.VisualDataChangeOperationKind | undefined;
}

export interface DetailHostAdapter {
    fetchMoreData(aggregateSegments: boolean): boolean;
}

export interface DetailDecision {
    readonly strategyId: DetailStrategyId;
    readonly state: DetailLoadState;
    readonly requestMore: boolean;
    readonly reason: string;
}

export interface DetailStrategy {
    readonly id: DetailStrategyId;
    evaluate(observation: DetailObservation): DetailDecision;
}
