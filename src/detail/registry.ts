import type { DetailStrategy, DetailStrategyId } from "./contract";

export class DetailStrategyRegistry {
    private readonly strategies = new Map<DetailStrategyId, DetailStrategy>();

    public register(strategy: DetailStrategy): void {
        if (this.strategies.has(strategy.id)) {
            throw new Error(`Detail strategy "${strategy.id}" is already registered.`);
        }
        this.strategies.set(strategy.id, strategy);
    }

    public resolve(id: DetailStrategyId): DetailStrategy {
        const strategy = this.strategies.get(id);
        if (!strategy) {
            throw new Error(`Detail strategy "${id}" is not registered.`);
        }
        return strategy;
    }

    public list(): readonly DetailStrategy[] {
        return [...this.strategies.values()];
    }
}
