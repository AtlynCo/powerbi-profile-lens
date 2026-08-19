import type { ContextMode, ContextProvider, ContextProviderInput, ContextScene } from "../contract";
import { featureFor, scene } from "./common";

export class Wgs84PointContextProvider implements ContextProvider {
    public readonly id = "wgs84-points";
    public readonly modes = ["points"] as const;

    public canProvide(mode: ContextMode, input: ContextProviderInput): boolean {
        return mode === "points" && input.coordinates.length > 0;
    }

    public provide(_mode: ContextMode, input: ContextProviderInput): ContextScene {
        const coordinates = new Map(input.coordinates.map(value => [value.entityIndex, value]));
        const entries = [];
        for (const entity of input.entities) {
            const coordinate = coordinates.get(entity.index);
            if (!coordinate) {
                continue;
            }
            entries.push(featureFor(entity, entries.length, {
                kind: "point",
                points: [{ x: coordinate.longitude, y: coordinate.latitude }],
                center: { x: coordinate.longitude, y: coordinate.latitude }
            }, input));
        }
        return scene(
            this.id,
            "points",
            entries.map((entry) => entry.feature),
            entries.map((entry) => entry.binding)
        );
    }
}
