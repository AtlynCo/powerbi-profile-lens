import type {
    ContextFeature,
    ContextMode,
    ContextProvider,
    ContextProviderInput,
    ContextScene
} from "../contract";
import type { Diagnostic, DiagnosticCode } from "../../model/contract";
import { LIMITS } from "../../model/contract";
import { GeometryParseError, parseStrictGeometry } from "../geometry";
import { messageKeyFor } from "../../model/diagnostics";
import { featureFor, safeRawExcerpt, scene } from "./common";

interface Rejections {
    code: DiagnosticCode;
    reason: string;
    count: number;
    examples: string[];
}

function reject(
    groups: Map<string, Rejections>,
    code: DiagnosticCode,
    reason: string,
    raw: string
): void {
    const key = `${code}\0${reason}`;
    let group = groups.get(key);
    if (!group) {
        group = { code, reason, count: 0, examples: [] };
        groups.set(key, group);
    }
    group.count++;
    if (group.examples.length < LIMITS.maxDiagnosticExamples) {
        group.examples.push(safeRawExcerpt(raw));
    }
}

export class BoundGeometryContextProvider implements ContextProvider {
    public readonly id = "bound-geometry";
    public readonly modes = ["boundGeometry"] as const;

    public canProvide(mode: ContextMode, input: ContextProviderInput): boolean {
        return mode === "boundGeometry" && input.geometryTexts.length > 0;
    }

    public provide(_mode: ContextMode, input: ContextProviderInput): ContextScene {
        const byEntity = new Map(input.geometryTexts.map(value => [value.entityIndex, value]));
        const features: ContextFeature[] = [];
        const groups = new Map<string, Rejections>();
        let cumulativeCharacters = 0;
        let sceneVertices = 0;
        const maxCharacters = Math.min(
            input.authorLimits?.maxGeometryCharacters ?? LIMITS.maxGeometryCharacters,
            LIMITS.maxGeometryCharacters
        );
        const maxSceneVertices = Math.min(
            input.authorLimits?.maxSceneVertices ?? LIMITS.maxVerticesPerScene,
            LIMITS.maxVerticesPerScene
        );

        for (const entity of input.entities) {
            const source = byEntity.get(entity.index);
            if (!source) continue;
            const characters = Math.max(source.characters, source.text.length);
            cumulativeCharacters += characters;
            if (!source.withinCharacterLimit || characters > maxCharacters) {
                reject(groups, "oversizedGeometry", "geometry value character limit exceeded", source.text);
                continue;
            }
            if (cumulativeCharacters > LIMITS.maxGeometryCharactersPerUpdate) {
                reject(groups, "geometryUpdateBudgetExceeded", "geometry update character budget exceeded", source.text);
                continue;
            }
            if (features.length >= LIMITS.maxContextFeatures) {
                reject(groups, "geometryFeatureLimit", "context feature limit exceeded", source.text);
                continue;
            }
            try {
                const geometry = parseStrictGeometry(source.text);
                const vertices = geometry.points?.length
                    ?? geometry.polygons?.reduce((sum, polygon) =>
                        sum + polygon.reduce((ringSum, ring) => ringSum + ring.length, 0), 0)
                    ?? 0;
                if (sceneVertices + vertices > maxSceneVertices) {
                    reject(groups, "geometryVertexLimit", "scene vertex limit exceeded", source.text);
                    continue;
                }
                sceneVertices += vertices;
                features.push(featureFor(entity, features.length, geometry, input));
            } catch (error) {
                if (error instanceof GeometryParseError) {
                    reject(groups, error.code, error.reason, source.text);
                } else {
                    reject(groups, "geometryParseRejected", "geometry parser failed", source.text);
                }
            }
        }

        const rejected = [...groups.values()].reduce((sum, group) => sum + group.count, 0);
        const diagnostics: Diagnostic[] = [...groups.values()].map(group => ({
            code: group.code,
            severity: "warning",
            messageKey: messageKeyFor(group.code),
            received: input.geometryTexts.length,
            retained: features.length,
            rejected: group.count,
            detail: `${group.reason}; examples: ${group.examples.join(" | ")}`
        }));
        if (rejected > 0) {
            diagnostics.push({
                code: "contextScenePartial",
                severity: "warning",
                messageKey: messageKeyFor("contextScenePartial"),
                received: input.geometryTexts.length,
                retained: features.length,
                rejected
            });
        }
        return scene(this.id, "boundGeometry", features, diagnostics);
    }
}
