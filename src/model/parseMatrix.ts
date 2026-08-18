import powerbi from "powerbi-visuals-api";
import {
    BandRef,
    CellCounts,
    Diagnostic,
    EntityRef,
    HierarchyShape,
    IMPLICIT_INDEX,
    LIMITS,
    PeriodRef,
    ProfileCell,
    ProfileDataModel,
    ProfileRef,
    SeriesRef,
    TooltipDatum,
    TooltipFieldRef,
    bandIdentityKey,
    cellKey,
    tooltipKey
} from "./contract";
import { DiagnosticCollector } from "./diagnostics";
import { buildExtensionPayload, ExtensionSourceCell } from "./extension";
import { fingerprintDataView } from "./fingerprint";

type DataView = powerbi.DataView;
type DataViewMatrixNode = powerbi.DataViewMatrixNode;
type DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
type PrimitiveValue = powerbi.PrimitiveValue;

export const ROLES = {
    hierarchy: "Hierarchy",
    series: "Series",
    profiles: "Profiles",
    contextValue: "ContextValue",
    latitude: "Latitude",
    longitude: "Longitude",
    geometry: "Geometry",
    tooltips: "Tooltips"
} as const;

export interface ParseOptions {
    readonly maxProfiles: number;
    readonly maxSeries: number;
    readonly formatValue: (value: PrimitiveValue, formatString: string | null) => string;
}

export interface ParseDependencies {
    /**
     * Builds the host selection identity for a matrix row node. Optional so the parser stays pure
     * and fully testable without a host.
     */
    readonly createSelectionId?: (
        node: DataViewMatrixNode,
        levels: powerbi.DataViewHierarchyLevel[]
    ) => unknown;
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
    maxProfiles: LIMITS.maxProfiles,
    maxSeries: LIMITS.maxSeries,
    formatValue: (value) => (value === null || value === undefined ? "" : String(value))
};

interface RoleSourceIndex {
    readonly profiles: readonly number[];
    readonly tooltips: readonly number[];
    readonly contextValue: number | null;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly geometry: number | null;
    readonly profilesReceived: number;
    readonly tooltipsReceived: number;
}

interface SeriesResolution {
    readonly series: readonly SeriesRef[];
    readonly received: number;
}

/**
 * Parses the single matrix mapping into the immutable model.
 *
 * The traversal preserves host order for entities, periods and bands. Stable keys derived from the
 * level values are used for identity and focus restoration only, never for reordering.
 */
export function parseMatrix(
    dataView: DataView | undefined,
    options: ParseOptions = DEFAULT_PARSE_OPTIONS,
    dependencies: ParseDependencies = {}
): ProfileDataModel {
    const diagnostics = new DiagnosticCollector();
    const matrix = dataView?.matrix;
    const rowLevels = matrix?.rows?.levels ?? [];
    const hierarchy = resolveHierarchyShape(rowLevels);

    if (!matrix || rowLevels.length === 0) {
        return emptyModel(hierarchy, diagnostics, dataView, "needsEntity");
    }
    if (rowLevels.length > LIMITS.maxHierarchyDepth) {
        diagnostics.add("hierarchyDepthUnsupported", {
            received: rowLevels.length,
            retained: LIMITS.maxHierarchyDepth
        });
        return emptyModel(hierarchy, diagnostics, dataView, "needsEntity");
    }

    const valueSources = matrix.valueSources ?? [];
    const roleIndex = resolveRoleSources(valueSources, options, diagnostics);
    const seriesResolution = resolveSeries(matrix, options, diagnostics);

    if (rowLevels.length < 2) {
        return emptyModel(hierarchy, diagnostics, dataView, "needsBand");
    }
    if (roleIndex.profiles.length === 0) {
        return emptyModel(hierarchy, diagnostics, dataView, "needsProfile");
    }

    const profiles = roleIndex.profiles.map<ProfileRef>((sourceIndex, index) => {
        const source = valueSources[sourceIndex];
        return {
            index,
            key: sourceKey(source, sourceIndex),
            label: source.displayName ?? `Profile ${index + 1}`,
            formatString: source.format ?? null
        };
    });
    const tooltipFields = roleIndex.tooltips.map<TooltipFieldRef>((sourceIndex, index) => {
        const source = valueSources[sourceIndex];
        return {
            index,
            key: sourceKey(source, sourceIndex),
            label: source.displayName ?? `Tooltip ${index + 1}`,
            formatString: source.format ?? null
        };
    });

    const entities: EntityRef[] = [];
    const periodsByEntity = new Map<number, PeriodRef[]>();
    const bands: BandRef[] = [];
    const bandIndexByKey = new Map<string, number>();
    const cells: ProfileCell[] = [];
    const cellIndex = new Map<string, ProfileCell>();
    const bandIdentities = new Map<string, unknown>();
    const tooltipIndex = new Map<string, TooltipDatum[]>();
    const extensionCells: ExtensionSourceCell[] = [];

    let received = 0;
    let missing = 0;
    let nonNumeric = 0;
    let nonFinite = 0;
    let duplicate = 0;
    let overLimit = 0;
    let entitiesReceived = 0;
    let bandsReceived = 0;
    let hasAnyHighlight = false;
    let truncatedPeriods = 0;
    let periodsReceived = 0;

    const valueCount = Math.max(valueSources.length, 1);
    const rowRoot = matrix.rows?.root;
    const entityNodes = rowRoot?.children ?? [];

    for (const entityNode of entityNodes) {
        entitiesReceived++;
        if (entities.length >= LIMITS.maxEntities) {
            continue;
        }
        const entityIndex = entities.length;
        const entityKey = nodeKey(entityNode, entityIndex);
        entities.push({
            index: entityIndex,
            key: entityKey,
            label: nodeLabel(entityNode, entityKey),
            value: entityValue(entityNode.value),
            identity: dependencies.createSelectionId
                ? dependencies.createSelectionId(entityNode, rowLevels)
                : null
        });

        readExtensionValues(entityNode, entityIndex, "entityNode", roleIndex, valueCount, extensionCells);

        const periodRefs: PeriodRef[] = [];
        const bandContainers: Array<{ periodIndex: number; node: DataViewMatrixNode }> = [];

        if (hierarchy.hasPeriodLevel) {
            const periodNodes = entityNode.children ?? [];
            for (const periodNode of periodNodes) {
                periodsReceived++;
                if (periodRefs.length >= LIMITS.maxPeriods) {
                    truncatedPeriods++;
                    continue;
                }
                const periodIndex = periodRefs.length;
                const periodKey = nodeValueKey(periodNode, periodIndex);
                periodRefs.push({
                    index: periodIndex,
                    key: periodKey,
                    label: nodeLabel(periodNode, periodKey)
                });
                bandContainers.push({ periodIndex, node: periodNode });
            }
        } else {
            bandContainers.push({ periodIndex: IMPLICIT_INDEX, node: entityNode });
        }
        periodsByEntity.set(entityIndex, periodRefs);

        for (const container of bandContainers) {
            for (const bandNode of container.node.children ?? []) {
                bandsReceived++;
                const bandKeyValue = nodeValueKey(bandNode, bandIndexByKey.size);
                let bandIndex = bandIndexByKey.get(bandKeyValue);
                if (bandIndex === undefined) {
                    if (bands.length >= LIMITS.maxBands) {
                        overLimit += profiles.length * Math.max(seriesResolution.series.length, 1);
                        continue;
                    }
                    bandIndex = bands.length;
                    bandIndexByKey.set(bandKeyValue, bandIndex);
                    bands.push({
                        index: bandIndex,
                        key: bandKeyValue,
                        label: nodeLabel(bandNode, bandKeyValue)
                    });
                }

                readExtensionValues(
                    bandNode,
                    entityIndex,
                    "leafAggregate",
                    roleIndex,
                    valueCount,
                    extensionCells
                );

                if (dependencies.createSelectionId) {
                    bandIdentities.set(
                        bandIdentityKey(entityIndex, container.periodIndex, bandIndex),
                        dependencies.createSelectionId(bandNode, rowLevels)
                    );
                }

                const seriesIndices = seriesResolution.series.length === 0
                    ? [IMPLICIT_INDEX]
                    : seriesResolution.series.map((entry) => entry.index);

                for (const seriesIndex of seriesIndices) {
                    const columnLeaf = seriesIndex === IMPLICIT_INDEX ? 0 : seriesIndex;
                    const tooltipData: TooltipDatum[] = [];

                    for (const [profileIndex, sourceIndex] of roleIndex.profiles.entries()) {
                        received++;
                        const nodeValue = readNodeValue(bandNode, columnLeaf, sourceIndex, valueCount);
                        const address = {
                            entityIndex,
                            periodIndex: container.periodIndex,
                            bandIndex,
                            seriesIndex,
                            profileIndex
                        };
                        const key = cellKey(address);
                        if (cellIndex.has(key)) {
                            duplicate++;
                            continue;
                        }
                        if (cells.length >= LIMITS.maxRetainedCells) {
                            overLimit++;
                            continue;
                        }
                        const interpreted = interpretValue(nodeValue?.value);
                        if (interpreted.state === "missing") {
                            missing++;
                        } else if (interpreted.state === "nonNumeric") {
                            nonNumeric++;
                        } else if (interpreted.state === "nonFinite") {
                            nonFinite++;
                        }
                        const highlightRaw = nodeValue?.highlight;
                        const highlight = highlightRaw === undefined || highlightRaw === null
                            ? null
                            : interpretValue(highlightRaw).value;
                        const hasHighlight = highlightRaw !== undefined;
                        if (hasHighlight) {
                            hasAnyHighlight = true;
                        }
                        const cell: ProfileCell = {
                            ...address,
                            value: interpreted.value,
                            state: interpreted.state,
                            highlight,
                            hasHighlight
                        };
                        cells.push(cell);
                        cellIndex.set(key, cell);
                    }

                    for (const [fieldIndex, sourceIndex] of roleIndex.tooltips.entries()) {
                        const nodeValue = readNodeValue(bandNode, columnLeaf, sourceIndex, valueCount);
                        if (nodeValue?.value === undefined || nodeValue.value === null) {
                            continue;
                        }
                        tooltipData.push({
                            fieldIndex,
                            label: tooltipFields[fieldIndex].label,
                            value: options.formatValue(
                                nodeValue.value,
                                tooltipFields[fieldIndex].formatString
                            )
                        });
                    }
                    if (tooltipData.length > 0) {
                        tooltipIndex.set(
                            tooltipKey(entityIndex, container.periodIndex, bandIndex, seriesIndex),
                            tooltipData
                        );
                    }
                }
            }
        }
    }

    if (entitiesReceived > entities.length) {
        diagnostics.add("entitiesOverLimit", {
            received: entitiesReceived,
            retained: entities.length,
            rejected: entitiesReceived - entities.length
        });
    }
    if (truncatedPeriods > 0) {
        diagnostics.add("periodsOverLimit", {
            received: periodsReceived,
            retained: LIMITS.maxPeriods,
            rejected: truncatedPeriods
        });
    }
    if (bandsReceived > 0 && bands.length === 0) {
        diagnostics.add("needsBand");
    }
    if (bandIndexByKey.size >= LIMITS.maxBands && bandsReceived > bands.length) {
        diagnostics.add("bandsOverLimit", {
            received: bandsReceived,
            retained: bands.length
        });
    }
    if (duplicate > 0) {
        diagnostics.add("duplicateCells", { rejected: duplicate });
    }
    if (overLimit > 0) {
        diagnostics.add("cellsOverLimit", {
            received,
            retained: cells.length,
            rejected: overLimit
        });
    }
    if (missing > 0) {
        diagnostics.add("blankValues", { rejected: missing });
    }
    if (nonNumeric > 0) {
        diagnostics.add("nonNumericValues", { rejected: nonNumeric });
    }
    if (nonFinite > 0) {
        diagnostics.add("nonFiniteValues", { rejected: nonFinite });
    }
    if (hasAnyHighlight) {
        diagnostics.add("highlightActive");
    }

    const extension = buildExtensionPayload(extensionCells, roleIndex, valueSources, diagnostics);

    const counts: CellCounts = {
        received,
        retained: cells.length,
        missing,
        nonNumeric,
        nonFinite,
        duplicate,
        overLimit
    };

    const stage = bands.length === 0
        ? "needsBand"
        : entities.length === 0
            ? "needsEntity"
            : "ready";

    return {
        stage,
        hierarchy,
        entities,
        periodsByEntity,
        bands,
        series: seriesResolution.series,
        profiles,
        cells,
        cellIndex,
        bandIdentities,
        tooltipFields,
        tooltipIndex,
        extension,
        counts,
        segments: {
            requests: 1,
            maxRequests: LIMITS.maxSegmentRequests,
            moreDataAvailable: false,
            partial: false
        },
        hasAnyHighlight,
        diagnostics: diagnostics.build(),
        fingerprint: fingerprintDataView(dataView)
    };
}

export function resolveHierarchyShape(
    levels: readonly powerbi.DataViewHierarchyLevel[]
): HierarchyShape {
    const depth = levels.length;
    const labels = levels.map((level) => level.sources?.[0]?.displayName ?? "");
    const hasPeriodLevel = depth >= 3;
    return {
        depth,
        hasPeriodLevel,
        entityLevelLabel: labels[0] ?? "",
        periodLevelLabel: hasPeriodLevel ? labels[1] ?? "" : null,
        bandLevelLabel: depth >= 2 ? labels[depth - 1] ?? "" : null
    };
}

function resolveRoleSources(
    valueSources: readonly DataViewMetadataColumn[],
    options: ParseOptions,
    diagnostics: DiagnosticCollector
): RoleSourceIndex {
    const profiles: number[] = [];
    const tooltips: number[] = [];
    let contextValue: number | null = null;
    let latitude: number | null = null;
    let longitude: number | null = null;
    let geometry: number | null = null;
    let profilesReceived = 0;
    let tooltipsReceived = 0;

    for (const [index, source] of valueSources.entries()) {
        const roles = source.roles ?? {};
        if (roles[ROLES.profiles]) {
            profilesReceived++;
            if (profiles.length < Math.min(options.maxProfiles, LIMITS.maxProfiles)) {
                profiles.push(index);
            }
            continue;
        }
        if (roles[ROLES.tooltips]) {
            tooltipsReceived++;
            if (tooltips.length < LIMITS.maxTooltipFields) {
                tooltips.push(index);
            }
            continue;
        }
        if (roles[ROLES.contextValue] && contextValue === null) {
            contextValue = index;
            continue;
        }
        if (roles[ROLES.latitude] && latitude === null) {
            latitude = index;
            continue;
        }
        if (roles[ROLES.longitude] && longitude === null) {
            longitude = index;
            continue;
        }
        if (roles[ROLES.geometry] && geometry === null) {
            geometry = index;
        }
    }

    if (profilesReceived > profiles.length) {
        diagnostics.add("profilesOverLimit", {
            received: profilesReceived,
            retained: profiles.length,
            rejected: profilesReceived - profiles.length
        });
    }
    if (tooltipsReceived > tooltips.length) {
        diagnostics.add("tooltipFieldsOverLimit", {
            received: tooltipsReceived,
            retained: tooltips.length,
            rejected: tooltipsReceived - tooltips.length
        });
    }

    return {
        profiles,
        tooltips,
        contextValue,
        latitude,
        longitude,
        geometry,
        profilesReceived,
        tooltipsReceived
    };
}

function resolveSeries(
    matrix: powerbi.DataViewMatrix,
    options: ParseOptions,
    diagnostics: DiagnosticCollector
): SeriesResolution {
    const levels = matrix.columns?.levels ?? [];
    const seriesLevel = levels.findIndex((level) =>
        (level.sources ?? []).some((source) => source.roles?.[ROLES.series])
    );
    if (seriesLevel < 0) {
        return { series: [], received: 0 };
    }

    const nodes = collectNodesAtDepth(matrix.columns?.root, seriesLevel);
    const retained: SeriesRef[] = [];
    const cap = Math.min(options.maxSeries, LIMITS.maxSeries);
    for (const node of nodes) {
        if (retained.length >= cap) {
            continue;
        }
        const index = retained.length;
        const key = nodeKey(node, index);
        retained.push({ index, key, label: nodeLabel(node, key) });
    }
    if (nodes.length > retained.length) {
        diagnostics.add("seriesOverLimit", {
            received: nodes.length,
            retained: retained.length,
            rejected: nodes.length - retained.length
        });
    }
    return {
        series: retained,
        received: nodes.length
    };
}

function collectNodesAtDepth(
    root: DataViewMatrixNode | undefined,
    depth: number
): readonly DataViewMatrixNode[] {
    if (!root) {
        return [];
    }
    let current: DataViewMatrixNode[] = [...(root.children ?? [])];
    for (let level = 0; level < depth; level++) {
        const next: DataViewMatrixNode[] = [];
        for (const node of current) {
            next.push(...(node.children ?? []));
        }
        current = next;
    }
    return current;
}

function readNodeValue(
    node: DataViewMatrixNode,
    columnLeafIndex: number,
    valueSourceIndex: number,
    valueCount: number
): powerbi.DataViewMatrixNodeValue | undefined {
    const values = node.values;
    if (!values) {
        return undefined;
    }
    const flatIndex = columnLeafIndex * valueCount + valueSourceIndex;
    return values[flatIndex];
}

function readExtensionValues(
    node: DataViewMatrixNode,
    entityIndex: number,
    origin: "entityNode" | "leafAggregate",
    roleIndex: RoleSourceIndex,
    valueCount: number,
    sink: ExtensionSourceCell[]
): void {
    if (!node.values) {
        return;
    }
    const push = (role: ExtensionSourceCell["role"], sourceIndex: number | null): void => {
        if (sourceIndex === null) {
            return;
        }
        const nodeValue = readNodeValue(node, 0, sourceIndex, valueCount);
        if (nodeValue === undefined) {
            return;
        }
        sink.push({ role, entityIndex, origin, value: nodeValue.value ?? null, sourceIndex });
    };
    push("ContextValue", roleIndex.contextValue);
    push("Latitude", roleIndex.latitude);
    push("Longitude", roleIndex.longitude);
    push("Geometry", roleIndex.geometry);
}

interface InterpretedValue {
    readonly value: number | null;
    readonly state: ProfileCell["state"];
}

export function interpretValue(raw: PrimitiveValue | undefined): InterpretedValue {
    if (raw === undefined || raw === null || raw === "") {
        return { value: null, state: "missing" };
    }
    if (typeof raw === "number") {
        return Number.isFinite(raw)
            ? { value: raw, state: "value" }
            : { value: raw, state: "nonFinite" };
    }
    if (typeof raw === "boolean") {
        return { value: null, state: "nonNumeric" };
    }
    if (raw instanceof Date) {
        return { value: null, state: "nonNumeric" };
    }
    const parsed = Number(raw);
    if (typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(parsed)) {
        return Number.isFinite(parsed)
            ? { value: parsed, state: "value" }
            : { value: parsed, state: "nonFinite" };
    }
    return { value: null, state: "nonNumeric" };
}

function nodeKey(node: DataViewMatrixNode, fallbackIndex: number): string {
    const identityKey = (node.identity as { key?: string } | undefined)?.key;
    if (typeof identityKey === "string" && identityKey.length > 0) {
        return identityKey;
    }
    const value = node.value;
    if (value !== undefined && value !== null) {
        return `${typeof value}:${String(value)}`;
    }
    return `index:${fallbackIndex}`;
}

/**
 * Key for levels whose nodes repeat under different parents.
 *
 * Bands and periods are shared axes: the same band appears under every entity, and each occurrence
 * has its own node identity because the identity encodes the whole row path. Keying those levels by
 * their own value is what makes one ordered band axis out of the whole matrix, and it is also what
 * makes a genuinely repeated cell detectable as a duplicate instead of a new band.
 */
function nodeValueKey(node: DataViewMatrixNode, fallbackIndex: number): string {
    const value = node.value;
    if (value !== undefined && value !== null) {
        return value instanceof Date
            ? `date:${value.toISOString()}`
            : `${typeof value}:${String(value)}`;
    }
    return nodeKey(node, fallbackIndex);
}

function nodeLabel(node: DataViewMatrixNode, fallback: string): string {
    const value = node.value;
    if (value === undefined || value === null) {
        return fallback;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return String(value);
}

function entityValue(value: PrimitiveValue | undefined): EntityRef["value"] {
    if (value === undefined || value === null) {
        return null;
    }
    return value instanceof Date ? new Date(value.getTime()) : value;
}

function sourceKey(source: DataViewMetadataColumn | undefined, index: number): string {
    if (!source) {
        return `source:${index}`;
    }
    return source.queryName ?? `${source.displayName ?? "value"}:${index}`;
}

function emptyModel(
    hierarchy: HierarchyShape,
    diagnostics: DiagnosticCollector,
    dataView: DataView | undefined,
    stage: "needsEntity" | "needsBand" | "needsProfile"
): ProfileDataModel {
    const resolvedStage = hierarchy.depth === 0 && stage === "needsEntity" ? "empty" : stage;
    diagnostics.add(stage);
    const stageDiagnostics: readonly Diagnostic[] = diagnostics.build();
    return {
        stage: resolvedStage,
        hierarchy,
        entities: [],
        periodsByEntity: new Map(),
        bands: [],
        series: [],
        profiles: [],
        cells: [],
        cellIndex: new Map(),
        bandIdentities: new Map(),
        tooltipFields: [],
        tooltipIndex: new Map(),
        extension: {
            boundRoles: [],
            contextValues: [],
            coordinates: [],
            geometry: [],
            rejected: {
                nonFiniteContextValues: 0,
                invalidCoordinates: 0,
                conflictingCoordinates: 0,
                incompleteCoordinates: 0,
                oversizedGeometry: 0,
                emptyGeometry: 0
            }
        },
        counts: {
            received: 0,
            retained: 0,
            missing: 0,
            nonNumeric: 0,
            nonFinite: 0,
            duplicate: 0,
            overLimit: 0
        },
        segments: {
            requests: dataView ? 1 : 0,
            maxRequests: LIMITS.maxSegmentRequests,
            moreDataAvailable: false,
            partial: false
        },
        hasAnyHighlight: false,
        diagnostics: stageDiagnostics,
        fingerprint: fingerprintDataView(dataView)
    };
}
