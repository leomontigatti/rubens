import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import type { Plugin } from "vite-plus";

import { devPort } from "./scripts/worktree-port.ts";

// A worktree's `.env.local` (`scripts/worktree-port.ts`) holds its own PORT. Strict, so
// a port another server holds fails loudly instead of drifting to the next one.
const port = devPort(process.cwd());

const generated = ["src/routeTree.gen.ts", "src/organization/migrations/**"];

// The organization object's migrations are `.sql` files its generated index
// imports (`src/organization/migrations/migrations.js`): each loads as its text.
const sqlAsText: Plugin = {
  name: "underthing:sql-as-text",
  transform(code, id) {
    return id.endsWith(".sql")
      ? { code: `export default ${JSON.stringify(code)};`, map: null }
      : null;
  },
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port, strictPort: true },
  // No app plugins under Vitest: the Worker and Start only serve and build, and
  // in a test run they warn on every file and keep the process from exiting.
  // The Worker runs in workerd (Miniflare in dev), its `ssr` environment.
  plugins: process.env.VITEST
    ? []
    : [
        sqlAsText,
        cloudflare({ viteEnvironment: { name: "ssr" } }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
      ],

  lint: {
    ignorePatterns: ["dist/**", ".wrangler/**", ".tanstack/**", ...generated],
    plugins: ["react", "import", "typescript"],
    // The style guide's mechanical rules: `@shadcn/lint`, and `ui` for what it
    // does not cover. It reads the components and the theme from components.json.
    jsPlugins: ["@shadcn/lint", "./scripts/oxlint-ui-plugin.mjs"],
    settings: {
      shadcn: {
        note: "A colour, radius or state comes from a token or a variant; className is for layout (docs/agents/style-guide.md). A new token or variant is a product decision: ask before adding one.",
      },
    },
    options: { typeAware: true, typeCheck: true },
    rules: {
      "shadcn/no-restyle": [
        "error",
        {
          allow: ["layout"],
          // A card's content lays out its children; its padding stays the card's.
          contracts: [{ pattern: "^CardContent$", allow: ["layout", "gap-*"] }],
        },
      ],
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/no-inline-styles": "error",
      "shadcn/require-static-classes": "error",
      "ui/alert-structure": "error",
      "ui/no-bare-label": "error",
      "ui/no-raw-empty": "error",
      "ui/no-raw-form": "error",
      "ui/no-raw-form-element": "error",
      "ui/no-raw-page-title": "error",
      "ui/no-raw-table": "error",
      "ui/no-uncontrolled-input": "error",
      "ui/require-no-validate": "error",
      "ui/require-post-method": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "import/no-cycle": "error",
      "typescript/no-floating-promises": ["error", { checkThenables: true }],
      "typescript/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
    },
    overrides: [
      {
        // The components own their look, so they style themselves (base-nova
        // writes arbitrary values) and wrap the raw elements.
        files: ["src/components/ui/**"],
        rules: {
          "shadcn/no-restyle": "off",
          "shadcn/no-arbitrary-values": "off",
          "shadcn/require-static-classes": "off",
          "ui/no-bare-label": "off",
          "ui/no-raw-form-element": "off",
          "ui/no-raw-table": "off",
        },
      },
      {
        // The one place a form is drawn; the pages that are only their form, with
        // no list to return to; the patient's quick registration, a form of its
        // own inside booking; the reply to a patient, under the conversation it answers;
        // and the sandbox's scenario and patient's message, around its conversation.
        files: [
          "src/components/form-page.tsx",
          "src/components/patient-form.tsx",
          "src/routes/ingresar.tsx",
          "src/routes/_app/cambiar-contrasena.tsx",
          "src/routes/_app/disponibilidad/index.tsx",
          "src/routes/_app/whatsapp/index.tsx",
          "src/routes/_app/conversaciones/-hold.tsx",
          "src/routes/_app/whatsapp/prueba.tsx",
          "**/*.test.tsx",
        ],
        rules: {
          "ui/no-raw-form": "off",
          "ui/no-uncontrolled-input": "off",
        },
      },
      {
        // The one place an empty state is drawn.
        files: ["src/components/empty-state.tsx"],
        rules: {
          "ui/no-raw-empty": "off",
        },
      },
      {
        // The one place a table is drawn.
        files: ["src/components/data-table.tsx"],
        rules: {
          "ui/no-raw-table": "off",
        },
      },
      {
        // The one place a page's title is written.
        files: ["src/components/page-header.tsx"],
        rules: {
          "ui/no-raw-page-title": "off",
        },
      },
      {
        // Tests render whatever they need.
        files: ["**/*.test.tsx"],
        rules: {
          "shadcn/no-restyle": "off",
          "ui/no-raw-form-element": "off",
        },
      },
    ],
  },

  fmt: {
    ignorePatterns: ["pnpm-lock.yaml", ".claude/worktrees/**", ...generated],
    semi: true,
    trailingComma: "all",
    sortPackageJson: false,
  },

  staged: {
    "*": "vp check --fix",
  },

  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "src/**/*.test.{ts,tsx}",
            "scripts/**/*.test.ts",
            "tests/lint/**/*.test.ts",
            "tests/evals/**/*.test.ts",
          ],
          exclude: ["**/*.workers.test.ts", "node_modules/**"],
          environment: "node",
        },
      },
      {
        // The organization object's tests, in the Workers runtime: each test
        // file gets real SQLite storage of its own (#131).
        extends: true,
        plugins: [
          sqlAsText,
          cloudflareTest({
            main: "./src/organization/test-worker.ts",
            wrangler: { configPath: "./wrangler.jsonc" },
            // A made-up key, so the objects can seal what the app encrypts (ADR-0008).
            miniflare: { bindings: { ORGANIZATION_ENCRYPTION_KEY: btoa("k".repeat(32)) } },
          }),
        ],
        test: {
          name: "workers",
          include: ["src/**/*.workers.test.ts"],
          setupFiles: ["./src/organization/typing-pause.test-support.ts"],
        },
      },
    ],
  },
});
