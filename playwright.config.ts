import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke test configuration.
 *
 * The journey runs against a locally started production build so it exercises the
 * same server code that ships, not the dev bundler. Point BASE_URL at a deployed
 * alias to run the identical spec against production.
 */
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [["list"]],
  // The journey performs a real TLS handshake, a Certificate Transparency
  // lookup and an arXiv round trip before it reaches the destructive step, so
  // the per-test budget has to cover several third parties on a cold start.
  timeout: 300_000,
  expect: { timeout: 45_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Actionability is re-checked across animation frames, so a slow frame
    // under load reads as "element is not stable". A generous budget absorbs a
    // busy machine without relaxing any assertion.
    actionTimeout: 60_000,
    navigationTimeout: 90_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
});