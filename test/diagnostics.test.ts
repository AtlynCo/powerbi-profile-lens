import { describe, expect, it } from "vitest";
import { DiagnosticCollector, messageKeyFor, severityOf } from "../src/model/diagnostics";
import { SegmentTracker, mergeDiagnostics, withSegmentState } from "../src/model/segments";
import { parseMatrix } from "../src/model/parseMatrix";
import { buildMatrixDataView } from "./helpers/mockDataView";

describe("diagnostics", () => {
    it("emits a code once and merges its counts", () => {
        const collector = new DiagnosticCollector();
        collector.add("duplicateCells", { rejected: 2 });
        collector.add("duplicateCells", { rejected: 3 });
        const built = collector.build();
        expect(built).toHaveLength(1);
        expect(built[0].rejected).toBe(5);
    });

    it("orders errors before warnings before information", () => {
        const collector = new DiagnosticCollector();
        collector.add("highlightActive");
        collector.add("duplicateCells", { rejected: 1 });
        collector.add("hierarchyDepthUnsupported", { received: 4 });
        expect(collector.build().map((entry) => entry.code)).toEqual([
            "hierarchyDepthUnsupported",
            "duplicateCells",
            "highlightActive"
        ]);
    });

    it("derives resource keys and severities from the code", () => {
        expect(messageKeyFor("needsBand")).toBe("Diagnostic_NeedsBand");
        expect(severityOf("hierarchyDepthUnsupported")).toBe("error");
        expect(severityOf("seriesOverLimit")).toBe("warning");
        expect(severityOf("needsBand")).toBe("info");
    });

    it("omits count fields that were never supplied", () => {
        const collector = new DiagnosticCollector();
        collector.add("needsBand");
        expect(Object.keys(collector.build()[0])).toEqual(["code", "severity", "messageKey"]);
    });
});

describe("bounded segment accumulation", () => {
    const model = () => parseMatrix(buildMatrixDataView({
        entities: ["Entity A"],
        bands: ["Band 1", "Band 2"],
        profiles: ["Metric A"]
    }));

    it("counts one request per new query shape", () => {
        const tracker = new SegmentTracker(3);
        tracker.register("shape-a", 0);
        expect(tracker.state(false).requests).toBe(1);
        tracker.register("shape-a", 0);
        expect(tracker.state(false).requests).toBe(1);
        tracker.register("shape-b", 0);
        expect(tracker.state(false).requests).toBe(1);
    });

    it("accumulates appended segments up to the bound", () => {
        const tracker = new SegmentTracker(3);
        tracker.register("shape-a", 0);
        tracker.register("shape-a", 1);
        tracker.register("shape-a", 1);
        expect(tracker.state(true).requests).toBe(3);
        expect(tracker.canRequestMore()).toBe(false);
    });

    it("marks partial data and the segment limit as visible diagnostics", () => {
        const tracker = new SegmentTracker(2);
        tracker.register("shape-a", 0);
        tracker.register("shape-a", 1);
        const withState = withSegmentState(model(), tracker.state(true));
        const codes = withState.diagnostics.map((entry) => entry.code);
        expect(withState.segments.partial).toBe(true);
        expect(codes).toContain("partialData");
        expect(codes).toContain("segmentLimitReached");
    });

    it("reports complete data without a partial diagnostic", () => {
        const tracker = new SegmentTracker(2);
        tracker.register("shape-a", 0);
        const withState = withSegmentState(model(), tracker.state(false));
        expect(withState.segments.partial).toBe(false);
        expect(withState.diagnostics.map((entry) => entry.code)).not.toContain("partialData");
    });

    it("merges diagnostics without duplicating codes", () => {
        const merged = mergeDiagnostics(
            [{ code: "blankValues", severity: "info", messageKey: "Diagnostic_BlankValues", rejected: 1 }],
            [{ code: "blankValues", severity: "info", messageKey: "Diagnostic_BlankValues", rejected: 4 }]
        );
        expect(merged).toHaveLength(1);
        expect(merged[0].rejected).toBe(4);
    });

    it("resets after a query reset", () => {
        const tracker = new SegmentTracker(2);
        tracker.register("shape-a", 1);
        tracker.reset();
        expect(tracker.state(false).requests).toBe(0);
        expect(tracker.canRequestMore()).toBe(true);
    });
});
