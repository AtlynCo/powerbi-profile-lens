import type {
    ContextMode,
    ContextProvider,
    ContextProviderInput,
    ContextRenderer,
    ContextRendererKind
} from "./contract";

export class ContextProviderRegistry {
    private readonly providers = new Map<string, ContextProvider>();

    public register(provider: ContextProvider): void {
        if (this.providers.has(provider.id)) {
            throw new Error(`Context provider "${provider.id}" is already registered.`);
        }
        this.providers.set(provider.id, provider);
    }

    public resolve(mode: ContextMode, input: ContextProviderInput): ContextProvider | null {
        for (const provider of this.providers.values()) {
            if (provider.modes.includes(mode) && provider.canProvide(mode, input)) {
                return provider;
            }
        }
        return null;
    }

    public list(): readonly ContextProvider[] {
        return [...this.providers.values()];
    }
}

export class ContextRendererRegistry {
    private readonly renderers = new Map<ContextRendererKind, ContextRenderer>();

    public register(renderer: ContextRenderer): void {
        if (this.renderers.has(renderer.kind)) {
            throw new Error(`Context renderer "${renderer.kind}" is already registered.`);
        }
        this.renderers.set(renderer.kind, renderer);
    }

    public resolve(kind: ContextRendererKind): ContextRenderer {
        const renderer = this.renderers.get(kind);
        if (!renderer) {
            throw new Error(`Context renderer "${kind}" is not registered.`);
        }
        return renderer;
    }
}
