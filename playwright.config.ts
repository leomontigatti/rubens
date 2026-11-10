import process from "node:process";

import { defineConfig, devices } from "@playwright/test";

import { e2e } from "./tests/e2e/environment.ts";

// The browser suite (tests/e2e/README.md). `pnpm test:e2e` builds, clears the
// suite's object storage (`tests/e2e/prepare.ts`), then runs this: the
// production Worker served by `wrangler dev` with the dev sign-in, Chromium only. The `setup` project signs each role in once;
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
    // `--env-file` reads an empty file, so a Clerk key in a local `.env` cannot
    // switch the suite off the dev sign-in.
    command: [
      // Local only: Workers AI's binding would otherwise ask for a Cloudflare login.
      "pnpm exec wrangler dev --local",
      `--port ${e2e.port}`,
      "--var DEV_SIGN_IN:true",
      // Meta answered inside the Worker (`src/dev/fake-meta.ts`), on a made-up
      // test number for the dev organization, so a reply from the inbox goes out.
      "--var WHATSAPP_FAKE_META:true",
      "--var WHATSAPP_ACCESS_TOKEN:e2e-fake-token",
      "--var WHATSAPP_PHONE_NUMBER_ID:100000000000000",
      // `devOrganizationId` in src/server/caller.ts.
      "--var WHATSAPP_ORGANIZATION_ID:dev-organization",
      `--persist-to ${e2e.stateDirectory}`,
      "--env-file /dev/null",
      "--show-interactive-dev-session=false",
    ].join(" "),
    url: `${e2e.origin}/ingresar`,
    reuseExistingServer: false,
    stdout: "pipe",
  },
});
