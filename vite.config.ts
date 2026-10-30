import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite-plus";

// A worktree's `.env.local` (`pnpm db:worktree`) holds its own PORT. Strict, so
// a port another server holds fails loudly instead of drifting to the next one.
const port = Number(loadEnv("development", process.cwd(), "").PORT) || 3000;

const generated = ["src/routeTree.gen.ts", "src/db/migrations/**"];

// ADR-0004: tables and enums live in the `rubens` schema, so the helpers that
// declare them in `public` are banned everywhere.
const publicSchemaImports = {
  name: "drizzle-orm/pg-core",
  importNames: ["pgTable", "pgEnum"],
  message: "Use rubens.table() / rubens.enum() from #/db/schema/schema.ts (ADR-0004).",
};

// ADR-0002: tenant-owned tables are queried only inside withTenant(). Matched by
// specifier, so a relative path to the client is caught as well as the alias.
const rawDbClient = {
  group: ["#/db/client*", "**/db/client*"],
  message: "Query tenant-owned tables through withTenant() from #/db/tenant.ts (ADR-0002).",
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port, strictPort: true },
  // No app plugins under Vitest: Nitro and Start only serve and build, and in a
  // test run they warn on every file and keep the process from exiting.
  plugins: process.env.VITEST ? [] : [nitro(), tailwindcss(), tanstackStart(), viteReact()],

  lint: {
    ignorePatterns: [".output/**", ".nitro/**", ".tanstack/**", ...generated],
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
      "ui/no-raw-form-element": "error",
      "ui/require-no-validate": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "import/no-cycle": "error",
      "typescript/no-floating-promises": ["error", { checkThenables: true }],
      "typescript/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "no-restricted-imports": ["error", { paths: [publicSchemaImports], patterns: [rawDbClient] }],
    },
    overrides: [
      {
        // Where tenancy is implemented (`src/db`), where the tables are not
        // tenant-owned (Better Auth's), and the DB test harness.
        files: ["src/db/**", "src/lib/auth.ts", "tests/db/**"],
        rules: {
          "no-restricted-imports": ["error", { paths: [publicSchemaImports] }],
        },
      },
      {
        // The components own their look, so they style themselves (base-nova
        // writes arbitrary values) and wrap the raw elements.
        files: ["src/components/ui/**"],
        rules: {
          "shadcn/no-restyle": "off",
          "shadcn/no-arbitrary-values": "off",
          "ui/no-raw-form-element": "off",
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
          include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "tests/lint/**/*.test.ts"],
          exclude: ["**/*.db.test.ts", "node_modules/**"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: ["src/**/*.db.test.ts", "tests/db/**/*.db.test.ts"],
          environment: "node",
          // Each createTestDatabase() is its own PGlite, loaded from the one
          // migrated in globalSetup; files run in parallel, tests in a file
          // run serially (tests/db/README.md).
          fileParallelism: true,
          // Locally, two workers: on the 4-core dev laptop more run no faster
          // (7 took 32 s, 2 took 31 s) but hold more memory (4.1 GB against
          // 2.4), and agent threads share one memory limit. CI keeps the
          // default, one fewer than the runner's CPUs.
          maxWorkers: process.env.CI ? undefined : 2,
          // Vitest refuses one run over projects with different `maxWorkers`
          // in the same group, so a run over both projects runs this one
          // after `unit`.
          sequence: { groupOrder: 1 },
          // Files in a worker share loaded modules, so the app and Better Auth
          // load once per worker instead of once per file. A test that mocks a
          // module, stubs a global or fakes timers undoes it in its own
          // `afterEach`, or the next file in the worker inherits it.
          isolate: false,
          globalSetup: ["tests/db/global-setup.ts"],
        },
      },
    ],
  },
});
