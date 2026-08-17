import powerbiVisualsConfigs from "eslint-plugin-powerbi-visuals";

export default [
    powerbiVisualsConfigs.configs.recommended,
    {
        ignores: [
            "node_modules/**",
            "dist/**",
            ".tmp/**",
            "samples/**",
            "test-results/**",
            "playwright-report/**"
        ]
    }
];
