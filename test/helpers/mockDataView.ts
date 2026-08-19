import type powerbi from "powerbi-visuals-api";

type DataView = powerbi.DataView;
type DataViewMatrixNode = powerbi.DataViewMatrixNode;
type DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
type PrimitiveValue = powerbi.PrimitiveValue;

export interface CellAddressInput {
    readonly entityIndex: number;
    readonly periodIndex: number;
    readonly bandIndex: number;
    readonly seriesIndex: number;
    readonly profileIndex: number;
}

export interface MatrixInput {
    readonly entities: readonly string[];
    readonly periods?: readonly string[];
    readonly bands: readonly string[];
    readonly series?: readonly string[];
    readonly profiles: readonly string[];
    readonly value?: (address: CellAddressInput) => PrimitiveValue | null | undefined;
    readonly highlight?: (address: CellAddressInput) => PrimitiveValue | null | undefined;
    readonly tooltips?: readonly { name: string; value: PrimitiveValue }[];
    readonly contextValue?: (entityIndex: number) => PrimitiveValue | null | undefined;
    readonly latitude?: (entityIndex: number, bandIndex: number) => PrimitiveValue | null | undefined;
    readonly longitude?: (entityIndex: number, bandIndex: number) => PrimitiveValue | null | undefined;
    readonly geometry?: (entityIndex: number) => PrimitiveValue | null | undefined;
    /** Emits the extension role values on the band leaves instead of the entity node. */
    readonly extensionOnLeaves?: boolean;
    readonly duplicateFirstBand?: boolean;
    readonly objects?: powerbi.DataViewObjects;
    readonly segment?: boolean;
    readonly unloadedEntityIndexes?: readonly number[];
}

function metadata(
    displayName: string,
    role: string,
    extra: Partial<DataViewMetadataColumn> = {}
): DataViewMetadataColumn {
    return {
        displayName,
        queryName: `Table.${displayName}`,
        roles: { [role]: true },
        ...extra
    } as DataViewMetadataColumn;
}

function node(value: string, key: string, children?: DataViewMatrixNode[]): DataViewMatrixNode {
    return {
        value,
        identity: { key } as unknown as DataViewMatrixNode["identity"],
        children
    } as DataViewMatrixNode;
}

export function buildMatrixDataView(input: MatrixInput): DataView {
    const hasPeriods = (input.periods?.length ?? 0) > 0;
    const seriesLabels = input.series ?? [];
    const valueSources: DataViewMetadataColumn[] = [];

    const profileSourceIndexes = input.profiles.map((profile) => {
        valueSources.push(metadata(profile, "Profiles", { type: { numeric: true } as powerbi.ValueTypeDescriptor }));
        return valueSources.length - 1;
    });
    const contextIndex = input.contextValue
        ? (valueSources.push(metadata("Context", "ContextValue")), valueSources.length - 1)
        : null;
    const latitudeIndex = input.latitude
        ? (valueSources.push(metadata("Latitude", "Latitude")), valueSources.length - 1)
        : null;
    const longitudeIndex = input.longitude
        ? (valueSources.push(metadata("Longitude", "Longitude")), valueSources.length - 1)
        : null;
    const geometryIndex = input.geometry
        ? (valueSources.push(metadata("Geometry", "Geometry")), valueSources.length - 1)
        : null;
    const tooltipIndexes = (input.tooltips ?? []).map((tooltip) => {
        valueSources.push(metadata(tooltip.name, "Tooltips"));
        return valueSources.length - 1;
    });

    const valueCount = Math.max(valueSources.length, 1);
    const seriesCount = Math.max(seriesLabels.length, 1);

    const rowLevels: powerbi.DataViewHierarchyLevel[] = [
        { sources: [metadata("Entity", "Hierarchy")] }
    ];
    if (hasPeriods) {
        rowLevels.push({ sources: [metadata("Period", "Hierarchy")] });
    }
    rowLevels.push({ sources: [metadata("Band", "Hierarchy")] });

    const defaultValue = (address: CellAddressInput): PrimitiveValue =>
        (address.bandIndex + 1) * 10 + address.profileIndex + address.seriesIndex + 1;

    const buildBandNodes = (entityIndex: number, periodIndex: number): DataViewMatrixNode[] => {
        const bands = input.duplicateFirstBand
            ? [...input.bands, input.bands[0]]
            : input.bands;
        return bands.map((band, rawBandIndex) => {
            const bandIndex = input.duplicateFirstBand && rawBandIndex === bands.length - 1
                ? 0
                : rawBandIndex;
            const values: Record<number, powerbi.DataViewMatrixNodeValue> = {};
            for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex++) {
                const effectiveSeries = seriesLabels.length === 0 ? -1 : seriesIndex;
                for (const [profileIndex, sourceIndex] of profileSourceIndexes.entries()) {
                    const address: CellAddressInput = {
                        entityIndex,
                        periodIndex,
                        bandIndex,
                        seriesIndex: effectiveSeries,
                        profileIndex
                    };
                    const value = input.value ? input.value(address) : defaultValue(address);
                    const highlight = input.highlight?.(address);
                    values[seriesIndex * valueCount + sourceIndex] = {
                        value: value as PrimitiveValue,
                        ...(highlight === undefined ? {} : { highlight: highlight as PrimitiveValue })
                    } as powerbi.DataViewMatrixNodeValue;
                }
                for (const [tooltipIndex, sourceIndex] of tooltipIndexes.entries()) {
                    values[seriesIndex * valueCount + sourceIndex] = {
                        value: input.tooltips?.[tooltipIndex].value as PrimitiveValue
                    } as powerbi.DataViewMatrixNodeValue;
                }
                if (input.extensionOnLeaves) {
                    applyExtensionValues(values, seriesIndex * valueCount, entityIndex, bandIndex);
                }
            }
            return {
                ...node(band, `band:${entityIndex}:${periodIndex}:${rawBandIndex}`),
                values
            } as DataViewMatrixNode;
        });
    };

    const applyExtensionValues = (
        values: Record<number, powerbi.DataViewMatrixNodeValue>,
        offset: number,
        entityIndex: number,
        bandIndex = -1
    ): void => {
        const assign = (
            index: number | null,
            provider: ((
                entityIndex: number,
                bandIndex: number
            ) => PrimitiveValue | null | undefined) | undefined
        ): void => {
            if (index === null || !provider) {
                return;
            }
            const value = provider(entityIndex, bandIndex);
            if (value === undefined || value === null) {
                return;
            }
            values[offset + index] = { value } as powerbi.DataViewMatrixNodeValue;
        };
        assign(contextIndex, input.contextValue);
        assign(latitudeIndex, input.latitude);
        assign(longitudeIndex, input.longitude);
        assign(geometryIndex, input.geometry);
    };

    const entityNodes = input.entities.map((entity, entityIndex) => {
        const children = input.unloadedEntityIndexes?.includes(entityIndex)
            ? []
            : hasPeriods
            ? (input.periods ?? []).map((period, periodIndex) => ({
                ...node(period, `period:${entityIndex}:${periodIndex}`),
                children: buildBandNodes(entityIndex, periodIndex)
            } as DataViewMatrixNode))
            : buildBandNodes(entityIndex, -1);
        const entityValues: Record<number, powerbi.DataViewMatrixNodeValue> = {};
        if (!input.extensionOnLeaves) {
            applyExtensionValues(entityValues, 0, entityIndex);
        }
        const built = node(entity, `entity:${entityIndex}`, children);
        return Object.keys(entityValues).length > 0
            ? ({ ...built, values: entityValues } as DataViewMatrixNode)
            : built;
    });

    const columnLevels: powerbi.DataViewHierarchyLevel[] = seriesLabels.length > 0
        ? [{ sources: [metadata("Series", "Series")] }]
        : [];
    const columnRoot: DataViewMatrixNode = {
        children: seriesLabels.length > 0
            ? seriesLabels.map((series, index) => node(series, `series:${index}`))
            : valueSources.map((source, index) => node(source.displayName ?? "", `value:${index}`))
    } as DataViewMatrixNode;

    return {
        metadata: {
            columns: [...rowLevels.flatMap((level) => level.sources ?? []), ...valueSources],
            objects: input.objects,
            ...(input.segment ? { segment: {} } : {})
        },
        matrix: {
            rows: { levels: rowLevels, root: { children: entityNodes } as DataViewMatrixNode },
            columns: { levels: columnLevels, root: columnRoot },
            valueSources
        }
    } as DataView;
}

export function buildEmptyDataView(): DataView {
    return {
        metadata: { columns: [] },
        matrix: {
            rows: { levels: [], root: {} as DataViewMatrixNode },
            columns: { levels: [], root: {} as DataViewMatrixNode },
            valueSources: []
        }
    } as DataView;
}
