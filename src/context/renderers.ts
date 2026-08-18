import type {
    ContextRenderRequest,
    ContextRenderer,
    ContextRendererKind,
    ContextRendererResult
} from "./contract";
import { hitTestScene } from "./hitTest";

class RegisteredContextRenderer implements ContextRenderer {
    public readonly id: string;

    public constructor(public readonly kind: ContextRendererKind) {
        this.id = `${kind}-context`;
    }

    public render(request: ContextRenderRequest): ContextRendererResult {
        return {
            kind: this.kind,
            hitTest: (x, y) => hitTestScene(
                request.scene,
                request.transform,
                x,
                y,
                request.pointSize
            )
        };
    }
}

export function createDefaultContextRenderers(): readonly ContextRenderer[] {
    return [
        new RegisteredContextRenderer("svg"),
        new RegisteredContextRenderer("canvas")
    ];
}
