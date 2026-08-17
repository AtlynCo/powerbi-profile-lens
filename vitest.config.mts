import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "happy-dom",
        clearMocks: true,
        include: ["test/**/*.test.ts"],
        server: {
            deps: {
                inline: [/^powerbi-visuals-utils-/]
            }
        }
    }
});
