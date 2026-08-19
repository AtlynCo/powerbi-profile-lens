import type { ContextScene, ScenePoint } from "../contract";

const OFFSET_A = 0x811c9dc5;
const OFFSET_B = 0x9e3779b9;
const PRIME_A = 0x01000193;
const PRIME_B = 0x85ebca6b;

export function contextSceneIdentity(scene: ContextScene): string {
    const hash = new SceneHash();
    hash.string(scene.providerId);
    hash.string(scene.mode);
    hash.string(scene.metadata?.vintage ?? "");
    hash.string(scene.metadata?.policyId ?? "");
    hash.number(scene.backdrop.features.length);
    for (const feature of scene.backdrop.features) {
        hash.number(feature.index);
        hash.string(feature.key);
        hash.string(feature.geometry.kind);
        if (feature.geometry.points) {
            hash.number(feature.geometry.points.length);
            for (const point of feature.geometry.points) {
                hash.point(point);
            }
        } else {
            hash.number(feature.geometry.polygons?.length ?? 0);
            for (const polygon of feature.geometry.polygons ?? []) {
                hash.number(polygon.length);
                for (const ring of polygon) {
                    hash.number(ring.length);
                    for (const point of ring) {
                        hash.point(point);
                    }
                }
            }
        }
    }
    return `${scene.providerId}:${scene.mode}:${hash.hex()}`;
}

class SceneHash {
    private left = OFFSET_A;
    private right = OFFSET_B;
    private readonly numberBuffer = new ArrayBuffer(8);
    private readonly numberView = new DataView(this.numberBuffer);

    public string(value: string): void {
        this.number(value.length);
        for (let index = 0; index < value.length; index++) {
            const code = value.charCodeAt(index);
            this.byte(code & 0xff);
            this.byte(code >>> 8);
        }
    }

    public number(value: number): void {
        if (!Number.isFinite(value)) {
            throw new Error("Context scene identity requires finite numeric input.");
        }
        this.numberView.setFloat64(0, value, true);
        for (let index = 0; index < 8; index++) {
            this.byte(this.numberView.getUint8(index));
        }
    }

    public point(point: ScenePoint): void {
        this.number(point.x);
        this.number(point.y);
    }

    public hex(): string {
        return `${toHex(this.left)}${toHex(this.right)}`;
    }

    private byte(value: number): void {
        this.left = Math.imul(this.left ^ value, PRIME_A) >>> 0;
        this.right = Math.imul(this.right ^ (value + 0x9d), PRIME_B) >>> 0;
        this.right ^= this.left >>> 13;
    }
}

function toHex(value: number): string {
    return value.toString(16).padStart(8, "0");
}
