import type {
    ContextRenderRequest,
    ContextRenderer,
    ContextRendererKind,
    ContextRendererResult
} from "./contract";
import { hitTestScene } from "./hitTest";
import { cameraToBasePoint } from "./viewport/camera";

class RegisteredContextRenderer implements ContextRenderer {
    public readonly id: string;

    public constructor(public readonly kind: ContextRendererKind) {
        this.id = `${kind}-context`;
    }

    public render(request: ContextRenderRequest): ContextRendererResult {
        return {
            kind: this.kind,
            hitTest: (x, y) => {
                const point = cameraToBasePoint({ x, y }, request.camera);
                return hitTestScene(
                    request.scene,
                    request.baseTransform,
                    point.x,
                    point.y,
                    request.pointSize
                );
            }
        };
    }
}

export function createDefaultContextRenderers(): readonly ContextRenderer[] {
    return [
        new RegisteredContextRenderer("svg"),
        new RegisteredContextRenderer("canvas")
    ];
}
