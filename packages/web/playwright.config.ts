import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests on the built app. GitHub and the Claude API are simulated in memory
 * (request interception): no real network access.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:4173/eugenia/",
    serviceWorkers: "block",
    locale: "en-US",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx vite build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/eugenia/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
