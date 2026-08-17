import powerbi from "powerbi-visuals-api";
import {
    ContextValuePayload,
    CoordinatePayload,
    ExtensionPayload,
    ExtensionRole,
    GeometryFormatHint,
    GeometryPayload,
    LIMITS
} from "./contract";
import { DiagnosticCollector } from "./diagnostics";

type DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
type PrimitiveValue = powerbi.PrimitiveValue;

export interface ExtensionSourceCell {
    readonly role: ExtensionRole;
    readonly entityIndex: number;
    readonly origin: "entityNode" | "leafAggregate";
    readonly value: PrimitiveValue | null;
    readonly sourceIndex: number;
}

interface RoleSourceLookup {
    readonly contextValue: number | null;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly geometry: number | null;
}

const WKT_KEYWORDS = [
    "POINT",
    "MULTIPOINT",
    "LINESTRING",
    "MULTILINESTRING",
    "POLYGON",
    "MULTIPOLYGON",
    "GEOMETRYCOLLECTION"
];

/**
 * Builds the typed extension payload for the context and future map roles.
 *
 * These roles are exposed in the field wells on purpose, so a binding is never ignored: the values
 * are validated into an explicit structure and reported through diagnostics. Nothing in this
 * package consumes the payload, and geometry text is measured and classified but never parsed, so
 * binding a map role cannot start a rendering, projection or network path.
 */
export function buildExtensionPayload(
    cells: readonly ExtensionSourceCell[],
    roles: RoleSourceLookup,
    valueSources: readonly DataViewMetadataColumn[],
    diagnostics: DiagnosticCollector
): ExtensionPayload {
    const boundRoles: ExtensionRole[] = [];
    if (roles.contextValue !== null) {
        boundRoles.push("ContextValue");
    }
    if (roles.latitude !== null) {
        boundRoles.push("Latitude");
    }
    if (roles.longitude !== null) {
        boundRoles.push("Longitude");
    }
    if (roles.geometry !== null) {
        boundRoles.push("Geometry");
    }

    const contextValues = new Map<number, ContextValuePayload>();
    const latitudes = new Map<number, { value: number; origin: ExtensionSourceCell["origin"] }>();
    const longitudes = new Map<number, { value: number; origin: ExtensionSourceCell["origin"] }>();
    const geometry = new Map<number, GeometryPayload>();

    let nonFiniteContextValues = 0;
    let invalidCoordinates = 0;
    let conflictingCoordinates = 0;
    let incompleteCoordinates = 0;
    let oversizedGeometry = 0;
    let emptyGeometry = 0;

    const contextFormat = roles.contextValue === null
        ? null
        : valueSources[roles.contextValue]?.format ?? null;

    for (const cell of cells) {
        if (cell.value === null || cell.value === undefined) {
            continue;
        }
        switch (cell.role) {
            case "ContextValue": {
                const numeric = toFiniteNumber(cell.value);
                if (numeric === null) {
                    nonFiniteContextValues++;
                    break;
                }
                const existing = contextValues.get(cell.entityIndex);
                if (existing && existing.origin === "entityNode") {
                    break;
                }
                contextValues.set(cell.entityIndex, {
                    entityIndex: cell.entityIndex,
                    value: numeric,
                    formatString: contextFormat,
                    origin: cell.origin
                });
                break;
            }
            case "Latitude": {
                const numeric = toFiniteNumber(cell.value);
                if (numeric === null || numeric < LIMITS.minLatitude || numeric > LIMITS.maxLatitude) {
                    invalidCoordinates++;
                    break;
                }
                const existing = latitudes.get(cell.entityIndex);
                if (existing && existing.value !== numeric) {
                    conflictingCoordinates++;
                    break;
                }
                if (!existing) {
                    latitudes.set(cell.entityIndex, { value: numeric, origin: cell.origin });
                }
                break;
            }
            case "Longitude": {
                const numeric = toFiniteNumber(cell.value);
                if (numeric === null || numeric < LIMITS.minLongitude || numeric > LIMITS.maxLongitude) {
                    invalidCoordinates++;
                    break;
                }
                const existing = longitudes.get(cell.entityIndex);
                if (existing && existing.value !== numeric) {
                    conflictingCoordinates++;
                    break;
                }
                if (!existing) {
                    longitudes.set(cell.entityIndex, { value: numeric, origin: cell.origin });
                }
                break;
            }
            case "Geometry": {
                const text = typeof cell.value === "string" ? cell.value : String(cell.value);
                const trimmed = text.trim();
                if (trimmed.length === 0) {
                    emptyGeometry++;
                    break;
                }
                const withinCharacterLimit = trimmed.length <= LIMITS.maxGeometryCharacters;
                if (!withinCharacterLimit) {
                    oversizedGeometry++;
                }
                const existing = geometry.get(cell.entityIndex);
                if (existing && existing.origin === "entityNode") {
                    break;
                }
                geometry.set(cell.entityIndex, {
                    entityIndex: cell.entityIndex,
                    text: trimmed,
                    characters: trimmed.length,
                    formatHint: classifyGeometry(trimmed),
                    withinCharacterLimit,
                    origin: cell.origin
                });
                break;
            }
        }
    }

    const coordinates: CoordinatePayload[] = [];
    const coordinateEntities = new Set<number>([...latitudes.keys(), ...longitudes.keys()]);
    for (const entityIndex of [...coordinateEntities].sort((left, right) => left - right)) {
        const latitude = latitudes.get(entityIndex);
        const longitude = longitudes.get(entityIndex);
        if (!latitude || !longitude) {
            incompleteCoordinates++;
            continue;
        }
        coordinates.push({
            entityIndex,
            latitude: latitude.value,
            longitude: longitude.value,
            origin: latitude.origin === "entityNode" && longitude.origin === "entityNode"
                ? "entityNode"
                : "leafAggregate"
        });
    }

    if (boundRoles.length > 0) {
        diagnostics.add("extensionRolesProfileOnly", {
            received: boundRoles.length,
            detail: boundRoles.join(", ")
        });
    }
    if (nonFiniteContextValues > 0) {
        diagnostics.add("nonFiniteContextValue", { rejected: nonFiniteContextValues });
    }
    if (invalidCoordinates > 0) {
        diagnostics.add("invalidCoordinates", { rejected: invalidCoordinates });
    }
    if (conflictingCoordinates > 0) {
        diagnostics.add("conflictingCoordinates", { rejected: conflictingCoordinates });
    }
    if (incompleteCoordinates > 0) {
        diagnostics.add("incompleteCoordinates", { rejected: incompleteCoordinates });
    }
    if (oversizedGeometry > 0) {
        diagnostics.add("oversizedGeometry", {
            rejected: oversizedGeometry,
            detail: String(LIMITS.maxGeometryCharacters)
        });
    }
    if (emptyGeometry > 0) {
        diagnostics.add("emptyGeometry", { rejected: emptyGeometry });
    }

    return {
        boundRoles,
        contextValues: sortByEntity([...contextValues.values()]),
        coordinates,
        geometry: sortByEntity([...geometry.values()]),
        rejected: {
            nonFiniteContextValues,
            invalidCoordinates,
            conflictingCoordinates,
            incompleteCoordinates,
            oversizedGeometry,
            emptyGeometry
        }
    };
}

/**
 * Classifies the shape of a bound geometry string without parsing it. A hint is metadata only: no
 * code path in this package turns a hint into geometry.
 */
export function classifyGeometry(text: string): GeometryFormatHint {
    const head = text.slice(0, 64).trim();
    if (head.startsWith("{")) {
        return "geoJsonCandidate";
    }
    const upper = head.toUpperCase();
    if (WKT_KEYWORDS.some((keyword) => upper.startsWith(keyword))) {
        return "wktCandidate";
    }
    return "unrecognized";
}

function toFiniteNumber(value: PrimitiveValue): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function sortByEntity<T extends { entityIndex: number }>(items: T[]): readonly T[] {
    return items.sort((left, right) => left.entityIndex - right.entityIndex);
}
