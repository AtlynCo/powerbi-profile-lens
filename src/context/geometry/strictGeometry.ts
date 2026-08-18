import type {
    ContextGeometry,
    LinearRing,
    MultiPolygonCoordinates,
    PolygonCoordinates,
    ScenePoint
} from "../contract";
import type { DiagnosticCode } from "../../model/contract";
import { LIMITS } from "../../model/contract";

export class GeometryParseError extends Error {
    public constructor(
        public readonly reason: string,
        public readonly code: DiagnosticCode = "geometryParseRejected"
    ) {
        super(reason);
    }
}

interface Counts {
    rings: number;
    vertices: number;
}

function fail(reason: string, code?: DiagnosticCode): never {
    throw new GeometryParseError(reason, code);
}

function point(value: unknown, counts: Counts): ScenePoint {
    if (!Array.isArray(value) || value.length !== 2
        || typeof value[0] !== "number" || typeof value[1] !== "number"
        || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
        fail("coordinate must contain exactly two finite numbers");
    }
    counts.vertices++;
    if (counts.vertices > LIMITS.maxVerticesPerFeature) {
        fail("feature vertex limit exceeded", "geometryVertexLimit");
    }
    if (value[0] < LIMITS.minLongitude || value[0] > LIMITS.maxLongitude
        || value[1] < LIMITS.minLatitude || value[1] > LIMITS.maxLatitude) {
        fail("coordinate is outside WGS84 bounds");
    }
    return { x: value[0], y: value[1] };
}

function samePoint(a: ScenePoint, b: ScenePoint): boolean {
    return a.x === b.x && a.y === b.y;
}

function ring(value: unknown, counts: Counts): LinearRing {
    if (!Array.isArray(value) || value.length < 4) {
        fail("ring must contain at least four positions");
    }
    counts.rings++;
    if (counts.rings > LIMITS.maxRingsPerFeature) {
        fail("feature ring limit exceeded", "geometryRingLimit");
    }
    const result = value.map(position => point(position, counts));
    if (!samePoint(result[0], result[result.length - 1])) {
        fail("ring is not closed");
    }
    return result;
}

function polygon(value: unknown, counts: Counts): PolygonCoordinates {
    if (!Array.isArray(value) || value.length === 0) {
        fail("polygon must contain at least one ring");
    }
    return value.map(item => ring(item, counts));
}

function multipolygon(value: unknown, counts: Counts): MultiPolygonCoordinates {
    if (!Array.isArray(value) || value.length === 0) {
        fail("multipolygon must contain at least one polygon");
    }
    return value.map(item => polygon(item, counts));
}

function centerOf(points: readonly ScenePoint[]): ScenePoint {
    let x = 0;
    let y = 0;
    for (const item of points) {
        x += item.x;
        y += item.y;
    }
    return { x: x / points.length, y: y / points.length };
}

function polygonCenter(polygons: MultiPolygonCoordinates): ScenePoint {
    return centerOf(polygons.flatMap(polygonValue => polygonValue[0]));
}

const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);

function inspectJson(value: unknown, depth: number): void {
    if (depth > LIMITS.maxGeometryNesting) {
        fail("geometry nesting limit exceeded");
    }
    if (value !== null && typeof value === "object") {
        for (const key of Object.keys(value)) {
            if (unsafeKeys.has(key)) {
                fail("unsafe object key");
            }
            inspectJson((value as Record<string, unknown>)[key], depth + 1);
        }
    }
}

function isWgs84Crs(value: unknown): boolean {
    if (value === null) {
        return true;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const crs = value as Record<string, unknown>;
    const properties = crs.properties;
    if (crs.type !== "name" || typeof properties !== "object" || properties === null
        || Array.isArray(properties)) {
        return false;
    }
    const name = (properties as Record<string, unknown>).name;
    return typeof name === "string" && /(?:EPSG(?::|::)4326|CRS84)$/i.test(name);
}

function geoJsonGeometry(value: Record<string, unknown>): ContextGeometry {
    const counts: Counts = { rings: 0, vertices: 0 };
    switch (value.type) {
        case "Point": {
            const result = point(value.coordinates, counts);
            return { kind: "point", points: [result], center: result };
        }
        case "MultiPoint": {
            if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
                fail("multipoint must contain at least one position");
            }
            const points = value.coordinates.map(item => point(item, counts));
            return { kind: "multiPoint", points, center: centerOf(points) };
        }
        case "Polygon": {
            const polygons: MultiPolygonCoordinates = [polygon(value.coordinates, counts)];
            return { kind: "polygon", polygons, center: polygonCenter(polygons) };
        }
        case "MultiPolygon": {
            const polygons = multipolygon(value.coordinates, counts);
            return { kind: "multiPolygon", polygons, center: polygonCenter(polygons) };
        }
        case "FeatureCollection":
            fail("FeatureCollection is unsupported");
        case "GeometryCollection":
            fail("GeometryCollection is unsupported");
        case "LineString":
        case "MultiLineString":
            fail("line geometry is unsupported");
        default:
            fail("unknown geometry type");
    }
}

function parseGeoJson(text: string): ContextGeometry {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        fail("malformed GeoJSON");
    }
    inspectJson(parsed, 0);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        fail("GeoJSON root must be an object");
    }
    const root = parsed as Record<string, unknown>;
    if ("crs" in root && !isWgs84Crs(root.crs)) {
        fail("unknown or non-WGS84 CRS");
    }
    if (root.type === "Feature") {
        if (root.geometry === null || typeof root.geometry !== "object"
            || Array.isArray(root.geometry)) {
            fail("Feature geometry must be a geometry object");
        }
        const geometry = root.geometry as Record<string, unknown>;
        if ("crs" in geometry && !isWgs84Crs(geometry.crs)) {
            fail("unknown or non-WGS84 CRS");
        }
        return geoJsonGeometry(geometry);
    }
    return geoJsonGeometry(root);
}

type Token = string;

function tokenizeWkt(text: string): Token[] {
    const tokens: Token[] = [];
    const matcher = /\s+|[(),;=]|[A-Za-z_][A-Za-z_0-9]*|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?/gy;
    let offset = 0;
    while (offset < text.length) {
        matcher.lastIndex = offset;
        const match = matcher.exec(text);
        if (!match || match.index !== offset) {
            fail("malformed WKT token");
        }
        offset = matcher.lastIndex;
        if (!/^\s+$/.test(match[0])) {
            tokens.push(match[0]);
            if (tokens.length > LIMITS.maxWktTokens) {
                fail("WKT token limit exceeded");
            }
        }
    }
    return tokens;
}

class WktParser {
    private offset = 0;
    private readonly counts: Counts = { rings: 0, vertices: 0 };

    public constructor(private readonly tokens: readonly Token[]) {}

    public parse(): ContextGeometry {
        if (this.peekUpper() === "SRID") {
            this.take();
            this.expect("=");
            if (this.take() !== "4326") {
                fail("unknown or non-WGS84 CRS");
            }
            this.expect(";");
        }
        const type = this.take().toUpperCase();
        let result: ContextGeometry;
        switch (type) {
            case "POINT": {
                this.expect("(");
                const value = this.position();
                this.expect(")");
                result = { kind: "point", points: [value], center: value };
                break;
            }
            case "MULTIPOINT": {
                this.expect("(");
                const points: ScenePoint[] = [];
                const wrapped = this.peek() === "(";
                do {
                    if (wrapped) this.expect("(");
                    points.push(this.position());
                    if (wrapped) this.expect(")");
                } while (this.accept(","));
                this.expect(")");
                result = { kind: "multiPoint", points, center: centerOf(points) };
                break;
            }
            case "POLYGON": {
                const polygons: MultiPolygonCoordinates = [this.polygonBody()];
                result = { kind: "polygon", polygons, center: polygonCenter(polygons) };
                break;
            }
            case "MULTIPOLYGON": {
                this.expect("(");
                const polygons: PolygonCoordinates[] = [];
                do {
                    polygons.push(this.polygonBody());
                } while (this.accept(","));
                this.expect(")");
                if (polygons.length === 0) fail("multipolygon must contain a polygon");
                result = { kind: "multiPolygon", polygons, center: polygonCenter(polygons) };
                break;
            }
            case "LINESTRING":
            case "MULTILINESTRING":
                fail("line geometry is unsupported");
            case "GEOMETRYCOLLECTION":
                fail("GeometryCollection is unsupported");
            default:
                fail("unknown WKT geometry type");
        }
        if (this.offset !== this.tokens.length) {
            fail("trailing WKT content");
        }
        return result;
    }

    private polygonBody(): PolygonCoordinates {
        this.expect("(");
        const rings: LinearRing[] = [];
        do {
            this.expect("(");
            const points: ScenePoint[] = [];
            do {
                points.push(this.position());
            } while (this.accept(","));
            this.expect(")");
            this.counts.rings++;
            if (this.counts.rings > LIMITS.maxRingsPerFeature) {
                fail("feature ring limit exceeded", "geometryRingLimit");
            }
            if (points.length < 4) fail("ring must contain at least four positions");
            if (!samePoint(points[0], points[points.length - 1])) fail("ring is not closed");
            rings.push(points);
        } while (this.accept(","));
        this.expect(")");
        if (rings.length === 0) fail("polygon must contain a ring");
        return rings;
    }

    private position(): ScenePoint {
        const x = this.number();
        const y = this.number();
        if (this.peek() !== "," && this.peek() !== ")") {
            fail("coordinate must contain exactly two dimensions");
        }
        this.counts.vertices++;
        if (this.counts.vertices > LIMITS.maxVerticesPerFeature) {
            fail("feature vertex limit exceeded", "geometryVertexLimit");
        }
        if (x < LIMITS.minLongitude || x > LIMITS.maxLongitude
            || y < LIMITS.minLatitude || y > LIMITS.maxLatitude) {
            fail("coordinate is outside WGS84 bounds");
        }
        return { x, y };
    }

    private number(): number {
        const token = this.take();
        if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?$/.test(token)) {
            fail("expected finite coordinate number");
        }
        const value = Number(token);
        if (!Number.isFinite(value)) fail("coordinate is nonfinite");
        return value;
    }

    private peek(): string | undefined { return this.tokens[this.offset]; }
    private peekUpper(): string | undefined { return this.peek()?.toUpperCase(); }
    private take(): string {
        const token = this.tokens[this.offset++];
        if (token === undefined) fail("unexpected end of WKT");
        return token;
    }
    private expect(token: string): void {
        if (this.take().toUpperCase() !== token) fail(`expected '${token}'`);
    }
    private accept(token: string): boolean {
        if (this.peek() !== token) return false;
        this.offset++;
        return true;
    }
}

export function parseStrictGeometry(text: string): ContextGeometry {
    const trimmed = text.trim();
    if (!trimmed) fail("geometry is empty");
    return trimmed.startsWith("{")
        ? parseGeoJson(trimmed)
        : new WktParser(tokenizeWkt(trimmed)).parse();
}
