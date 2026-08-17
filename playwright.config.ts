import { defineConfig } from "@playwright/test";

// The browser probe deliberately runs the *packaged* visual bundle extracted from the
// generated .pbiviz, not a test-only build, so layout, focus, high contrast and
// network abstinence are proven on the artifact that would be submitted.
export default defineConfig({
    testDir: "./test",
    testMatch: "**/*.playwright.ts",
    timeout: 60000,
    fullyParallel: false,
    workers: 1,
    reporter: process.env.CI ? "line" : "list",
    use: {
        headless: true,
        viewport: { width: 1280, height: 620 }
    },
    projects: [
        {
            name: "packaged-chromium",
            use: { browserName: "chromium" }
        }
    ]
});
