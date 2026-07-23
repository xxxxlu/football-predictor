import { defineConfig, devices } from "@playwright/test";

// Story 7.5 gate G1 — main-journey E2E harness (scaffolding-first).
// baseURL points at a running web server. In CI the e2e job runs migrations against the postgres
// service, builds the app, and lets the webServer block below boot `next start`. Locally, set
// PLAYWRIGHT_BASE_URL to an already-running dev server to reuse it instead of starting a new one.
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
const port = Number(new URL(baseURL).port || "3001");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Report artifacts (Story 7.5 Task 6): human-readable HTML + JUnit XML for CI upload.
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }], ["junit", { outputFile: "playwright-report/results.xml" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next start -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
