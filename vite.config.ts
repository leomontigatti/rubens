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
    options: { typeAware: true, typeCheck: true },
    rules: {
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
          // One PGlite instance per file; files run in parallel, tests in a
          // file run serially (tests/db/README.md).
          fileParallelism: true,
        },
      },
    ],
  },
});
