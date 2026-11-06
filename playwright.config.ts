import process from "node:process";

import { defineConfig, devices } from "@playwright/test";

import { e2e } from "./tests/e2e/environment.ts";

// The browser suite (tests/e2e/README.md). `pnpm test:e2e` builds, rebuilds the
// e2e database (`tests/e2e/prepare.ts`), then runs this: the production build
// served as shipped, Chromium only. The `setup` project signs each role in once;
// every spec starts signed in from the state it saved.

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results/e2e",
  forbidOnly: ci,
  // No retries: a spec that passes on its second try is a flake to fix, and
  // the job is meant to become required only after weeks without one.
  retries: 0,
  workers: ci ? 2 : undefined,
  reporter: ci ? [["github"], ["list"]] : "list",
  use: {
    baseURL: e2e.origin,
    viewport: { width: 1440, height: 900 },
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      testMatch: /\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "node .output/server/index.mjs",
    url: e2e.origin,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      PORT: String(e2e.port),
      DATABASE_URL: e2e.databaseUrl,
      DATABASE_DIRECT_URL: e2e.directDatabaseUrl,
      BETTER_AUTH_URL: e2e.origin,
      BETTER_AUTH_SECRET: e2e.authSecret,
    },
  },
});
