import { defineConfig, devices } from "@playwright/test";

// Tests a running Kollaudo, at KOLLAUDO_URL. Run them with ./run.sh, which also prepares the data.
export default defineConfig({
  testDir: "tests",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    // The report Kollaudo receives: its own tests, sent with `kollaudo push` (docs/recipes/playwright.md).
    ["playwright-ctrf-json-reporter", { outputDir: "ctrf", outputFile: "ctrf-report.json" }],
  ],
  use: {
    baseURL: process.env.KOLLAUDO_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
