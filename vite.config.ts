import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite-plus";

// A worktree's `.env.local` (`pnpm db:worktree`) holds its own PORT. Strict, so
// a port another server holds fails loudly instead of drifting to the next one.
const port = Number(loadEnv("development", process.cwd(), "").PORT) || 3000;

const generated = ["src/routeTree.gen.ts", "src/db/migrations/**"];

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
    },
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
          include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
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
