import type {
    ContextGeometry,
    ContextMode,
    ContextProvider,
    ContextProviderInput,
    ContextScene,
    ScenePoint
} from "../contract";
import { featureFor, scene } from "./common";

function stableRanks(input: ContextProviderInput): ReadonlyMap<number, number> {
    const sorted = [...input.entities].sort((a, b) =>
        a.key.localeCompare(b.key) || a.index - b.index);
    return new Map(sorted.map((entity, rank) => [entity.index, rank]));
}

function rectangle(rank: number, count: number): ContextGeometry {
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
    const column = rank % columns;
    const row = Math.floor(rank / columns);
    const ring: ScenePoint[] = [
        { x: column, y: row },
        { x: column + 1, y: row },
        { x: column + 1, y: row + 1 },
        { x: column, y: row + 1 },
        { x: column, y: row }
    ];
    return {
        kind: "grid",
        polygons: [[ring]],
        center: { x: column + 0.5, y: row + 0.5 }
    };
}

function oddRHex(rank: number, count: number): ContextGeometry {
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
    const column = rank % columns;
    const row = Math.floor(rank / columns);
    const center = {
        x: Math.sqrt(3) * (column + 0.5 * (row & 1)),
        y: 1.5 * row
    };
    const ring: ScenePoint[] = [];
    for (let side = 0; side < 6; side++) {
        const angle = Math.PI / 180 * (60 * side - 30);
        ring.push({ x: center.x + Math.cos(angle), y: center.y + Math.sin(angle) });
    }
    ring.push(ring[0]);
    return { kind: "hex", polygons: [[ring]], center };
}

abstract class DeterministicTessellationProvider implements ContextProvider {
    public abstract readonly id: string;
    public abstract readonly modes: readonly ContextMode[];
    protected abstract geometry(rank: number, count: number): ContextGeometry;

    public canProvide(mode: ContextMode, input: ContextProviderInput): boolean {
        return this.modes.includes(mode) && input.entities.length > 0;
    }

    public provide(mode: ContextMode, input: ContextProviderInput): ContextScene {
        const ranks = stableRanks(input);
        const features = input.entities.map((entity, index) =>
            featureFor(entity, index, this.geometry(ranks.get(entity.index)!, input.entities.length), input));
        return scene(this.id, mode, features);
    }
}

export class RectangularGridContextProvider extends DeterministicTessellationProvider {
    public readonly id = "rectangular-grid";
    public readonly modes = ["grid"] as const;
    protected geometry(rank: number, count: number): ContextGeometry {
        return rectangle(rank, count);
    }
}

export class OddRHexContextProvider extends DeterministicTessellationProvider {
    public readonly id = "odd-r-hex";
    public readonly modes = ["hex"] as const;
    protected geometry(rank: number, count: number): ContextGeometry {
        return oddRHex(rank, count);
    }
}

