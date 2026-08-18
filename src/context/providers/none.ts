import type { ContextMode, ContextProvider, ContextProviderInput, ContextScene } from "../contract";
import { scene } from "./common";

export class NoneContextProvider implements ContextProvider {
    public readonly id = "none";
    public readonly modes = ["none"] as const;

    public canProvide(mode: ContextMode, _input: ContextProviderInput): boolean {
        return mode === "none";
    }

    public provide(_mode: ContextMode, _input: ContextProviderInput): ContextScene {
        return scene(this.id, "none", []);
    }
}

