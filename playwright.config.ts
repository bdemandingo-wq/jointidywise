import { defineConfig, devices } from "@playwright/test";

/**
 * Standalone Playwright config — intentionally has no dependency on any
 * private/internal package so it runs the same way in any environment.
 * Points at the local Vite dev server (see vite.config.ts: port 8080).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // Screenshot capture is a tool, not a test — keep it out of the default run.
      testIgnore: /\.screenshots\.spec\.ts/,
    },
    {
      // Before/after visual capture. Run explicitly:
      //   PROSE_PHASE=before npx playwright test --project=screenshots
      name: "screenshots",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /\.screenshots\.spec\.ts/,
    },
  ],
  webServer: {
    command: "VITE_TIDYWISE_TAG_TEST_HOSTS=localhost npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
