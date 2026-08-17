import powerbi from "powerbi-visuals-api";

type DataView = powerbi.DataView;

/**
 * Fingerprints the data-bearing shape of a data view.
 *
 * Lifecycle-only updates (resize, view mode, style changes) arrive without a new data view or with
 * the same query shape. The visual reuses its cached model only when the fingerprint matches, so a
 * genuine model or filter change can never be served from a stale cache.
 */
export function fingerprintDataView(dataView: DataView | undefined): string {
    if (!dataView) {
        return "none";
    }
    const matrix = dataView.matrix;
    if (!matrix) {
        return "no-matrix";
    }
    const rowLevels = (matrix.rows?.levels ?? [])
        .map((level) => (level.sources ?? []).map(sourceToken).join("+"))
        .join(">");
    const columnLevels = (matrix.columns?.levels ?? [])
        .map((level) => (level.sources ?? []).map(sourceToken).join("+"))
        .join(">");
    const valueSources = (matrix.valueSources ?? []).map(sourceToken).join(",");
    const rowCount = countNodes(matrix.rows?.root);
    const columnCount = countNodes(matrix.columns?.root);
    const segments = dataView.metadata?.segment ? "segment" : "complete";
    return [
        `rows:${rowLevels}`,
        `cols:${columnLevels}`,
        `values:${valueSources}`,
        `rowNodes:${rowCount}`,
        `colNodes:${columnCount}`,
        segments
    ].join("|");
}

function sourceToken(source: powerbi.DataViewMetadataColumn): string {
    const roles = Object.keys(source.roles ?? {}).sort().join("/");
    return `${source.queryName ?? source.displayName ?? "?"}[${roles}]`;
}

function countNodes(node: powerbi.DataViewMatrixNode | undefined): number {
    if (!node) {
        return 0;
    }
    let total = 0;
    const stack: powerbi.DataViewMatrixNode[] = [...(node.children ?? [])];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }
        total++;
        for (const child of current.children ?? []) {
            stack.push(child);
        }
    }
    return total;
}
