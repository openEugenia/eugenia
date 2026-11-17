import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout sur l'application construite. GitHub et l'API Claude sont
 * simulés en mémoire (interception des requêtes) : aucun accès réseau réel.
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
    locale: "fr-FR",
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
