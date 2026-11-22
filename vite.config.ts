import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import type { Plugin } from "vite-plus";

import typeAssertionAllowlist from "./scripts/type-assertion-allowlist.json" with { type: "json" };
import { devPort } from "./scripts/worktree-port.ts";

// A worktree's `.env.local` (`scripts/worktree-port.ts`) holds its own PORT. Strict, so
// a port another server holds fails loudly instead of drifting to the next one.
const port = devPort(process.cwd());

// Oxlint's correctness category, pinned rule by rule as errors: an Oxlint upgrade
// adds a rule only through this list, and no rule sits as a warning nobody reads.
// All but `unicorn/no-useless-spread`, which flags spreads that group values on purpose.
const correctness = [
  "constructor-super",
  "for-direction",
  "getter-return",
  "no-async-promise-executor",
  "no-caller",
  "no-class-assign",
  "no-compare-neg-zero",
  "no-cond-assign",
  "no-const-assign",
  "no-constant-binary-expression",
  "no-constant-condition",
  "no-control-regex",
  "no-debugger",
  "no-delete-var",
  "no-dupe-class-members",
  "no-dupe-else-if",
  "no-dupe-keys",
  "no-duplicate-case",
  "no-empty-character-class",
  "no-empty-pattern",
  "no-empty-static-block",
  "no-eval",
  "no-ex-assign",
  "no-extra-boolean-cast",
  "no-func-assign",
  "no-global-assign",
  "no-import-assign",
  "no-invalid-regexp",
  "no-irregular-whitespace",
  "no-iterator",
  "no-loss-of-precision",
  "no-misleading-character-class",
  "no-new-native-nonconstructor",
  "no-nonoctal-decimal-escape",
  "no-obj-calls",
  "no-self-assign",
  "no-setter-return",
  "no-shadow-restricted-names",
  "no-sparse-arrays",
  "no-this-before-super",
  "no-unassigned-vars",
  "no-unreachable",
  "no-unsafe-finally",
  "no-unsafe-negation",
  "no-unsafe-optional-chaining",
  "no-unused-expressions",
  "no-unused-labels",
  "no-unused-private-class-members",
  "no-unused-vars",
  "no-useless-backreference",
  "no-useless-catch",
  "no-useless-escape",
  "no-useless-rename",
  "no-with",
  "require-yield",
  "use-isnan",
  "valid-typeof",
  "import/default",
  "import/namespace",
  "react/error-boundaries",
  "react/forward-ref-uses-ref",
  "react/globals",
  "react/immutability",
  "react/incompatible-library",
  "react/jsx-key",
  "react/jsx-no-duplicate-props",
  "react/jsx-no-undef",
  "react/jsx-props-no-spread-multi",
  "react/no-children-prop",
  "react/no-danger-with-children",
  "react/no-did-mount-set-state",
  "react/no-did-update-set-state",
  "react/no-direct-mutation-state",
  "react/no-find-dom-node",
  "react/no-is-mounted",
  "react/no-render-return-value",
  "react/no-string-refs",
  "react/no-this-in-sfc",
  "react/no-unsafe",
  "react/no-will-update-set-state",
  "react/preserve-manual-memoization",
  "react/purity",
  "react/refs",
  "react/set-state-in-effect",
  "react/set-state-in-render",
  "react/static-components",
  "react/use-memo",
  "react/void-dom-elements-no-children",
  "react/void-use-memo",
  "typescript/await-thenable",
  "typescript/no-array-delete",
  "typescript/no-base-to-string",
  "typescript/no-duplicate-enum-values",
  "typescript/no-duplicate-type-constituents",
  "typescript/no-extra-non-null-assertion",
  "typescript/no-for-in-array",
  "typescript/no-implied-eval",
  "typescript/no-meaningless-void-operator",
  "typescript/no-misused-new",
  "typescript/no-misused-spread",
  "typescript/no-non-null-asserted-optional-chain",
  "typescript/no-redundant-type-constituents",
  "typescript/no-this-alias",
  "typescript/no-unnecessary-parameter-property-assignment",
  "typescript/no-unsafe-declaration-merging",
  "typescript/no-unsafe-unary-minus",
  "typescript/no-useless-default-assignment",
  "typescript/no-useless-empty-export",
  "typescript/no-wrapper-object-types",
  "typescript/prefer-as-const",
  "typescript/prefer-namespace-keyword",
  "typescript/require-array-sort-compare",
  "typescript/restrict-template-expressions",
  "typescript/triple-slash-reference",
  "typescript/unbound-method",
  "unicorn/no-await-in-promise-methods",
  "unicorn/no-empty-file",
  "unicorn/no-invalid-fetch-options",
  "unicorn/no-invalid-remove-event-listener",
  "unicorn/no-new-array",
  "unicorn/no-single-promise-in-promise-methods",
  "unicorn/no-thenable",
  "unicorn/no-unnecessary-await",
  "unicorn/no-useless-fallback-in-spread",
  "unicorn/no-useless-length-check",
  "unicorn/prefer-set-size",
  "unicorn/prefer-string-starts-ends-with",
];

const generated = [
  "src/routeTree.gen.ts",
  "src/organization/migrations/**",
  "worker-configuration.d.ts",
];
// Agent skills copied from dependencies (`skills-lock.json`), and Claude Code's links
// to them: theirs, kept as published.
const vendoredSkills = [".agents/skills/**", ".claude/skills/**"];

// Where a network call belongs, for the ban on the global `fetch` below.
const fetchBan =
  "A network call goes through the module that owns its boundary, where tests inject a fetcher: Meta's Graph API through src/organization/graph-api.ts (whatsappCloudFor, metaSignupFor), typed with its Fetcher. A new external service gets a module of its own, added to this rule's override in vite.config.ts.";

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
        // Workers AI is remote only, and the dev server runs offline: a voice
        // note there is not transcribed, and waits as one Workers AI could not hear.
        cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false }),
        tailwindcss(),
        tanstackStart(),
        viteReact(),
      ],

  lint: {
    ignorePatterns: ["dist/**", ".wrangler/**", ".tanstack/**", ...vendoredSkills, ...generated],
    plugins: ["react", "import", "typescript", "unicorn"],
    categories: { correctness: "off" },
    // The style guide's mechanical rules: `@shadcn/lint`, and `ui` for what it
    // does not cover. It reads the components and the theme from components.json.
    // `tests` holds the testing rules, which the test-code override turns on.
    jsPlugins: [
      "@shadcn/lint",
      "./scripts/oxlint-ui-plugin.mjs",
      "./scripts/oxlint-tests-plugin.mjs",
    ],
    settings: {
      shadcn: {
        note: "A colour, radius or state comes from a token or a variant; className is for layout (docs/agents/style-guide.md). A new token or variant is a product decision: ask before adding one.",
      },
    },
    options: { typeAware: true, typeCheck: true, reportUnusedDisableDirectives: "error" },
    rules: {
      ...Object.fromEntries(correctness.map((rule) => [rule, "error" as const])),
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
      "ui/create-names-thing": "error",
      "ui/no-bare-label": "error",
      "ui/no-menu-item-icon": "error",
      "ui/no-raw-date-format": "error",
      "ui/no-raw-empty": "error",
      "ui/no-raw-form": "error",
      "ui/no-raw-form-element": "error",
      "ui/no-raw-page-title": "error",
      "ui/no-raw-table": "error",
      "ui/no-status-column": "error",
      "ui/no-uncontrolled-input": "error",
      "ui/require-no-validate": "error",
      "ui/require-post-method": "error",
      "ui/use-archived-badge": "error",
      "ui/use-option-select": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              importNames: ["useEffect", "useLayoutEffect", "useInsertionEffect", "default"],
              message:
                "An effect hides a transition: put it in an event handler, in derived state, in a loader, or in a named hook in src/hooks (docs/agents/coding-standards.md#react).",
            },
          ],
        },
      ],
      "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "import/no-cycle": "error",
      "typescript/no-floating-promises": ["error", { checkThenables: true }],
      "typescript/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "typescript/no-unsafe-argument": "error",
      "typescript/no-unsafe-assignment": "error",
      "typescript/no-unsafe-call": "error",
      "typescript/no-unsafe-member-access": "error",
      "typescript/no-unsafe-return": "error",
      "typescript/no-unnecessary-type-assertion": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/ban-ts-comment": "error",
      "unicorn/no-abusive-eslint-disable": "error",
      // TanStack Router's redirect and not-found are thrown, as its loaders expect.
      "typescript/only-throw-error": [
        "error",
        {
          allow: [
            {
              from: "package",
              package: "@tanstack/router-core",
              name: ["Redirect", "NotFoundError"],
            },
          ],
        },
      ],
      "preserve-caught-error": "error",
      "no-empty": "error",
      "no-promise-executor-return": "error",
      "prefer-promise-reject-errors": "error",
      "no-warning-comments": "error",
      "typescript/switch-exhaustiveness-check": [
        "error",
        { allowDefaultCaseForExhaustiveSwitch: true, considerDefaultExhaustiveForUnions: false },
      ],
      "no-console": "error",
      "no-restricted-globals": ["error", { name: "fetch", message: fetchBan }],
      "no-restricted-properties": [
        "error",
        ...["globalThis", "window", "self"].map((object) => ({
          object,
          property: "fetch",
          message: fetchBan,
        })),
      ],
    },
    overrides: [
      {
        // The type assertions the ratchet still allows, and the shared utilities that
        // exist to hold one: `pnpm check:type-assertions` keeps this list and the
        // tree in step (docs/agents/coding-standards.md#type-assertions).
        files: [
          ...Object.keys(typeAssertionAllowlist.sharedUtilities),
          ...Object.keys(typeAssertionAllowlist.files),
        ],
        rules: {
          "typescript/consistent-type-assertions": "off",
        },
      },
      {
        // JavaScript declares no types, so the type-aware checks read each value as `any`.
        files: ["**/*.{js,jsx,mjs,cjs}"],
        rules: {
          "typescript/no-unsafe-argument": "off",
          "typescript/no-unsafe-assignment": "off",
          "typescript/no-unsafe-call": "off",
          "typescript/no-unsafe-member-access": "off",
          "typescript/no-unsafe-return": "off",
        },
      },
      {
        // The one place the app logs, and the command-line programs, whose output is
        // what they print.
        files: ["src/lib/log.ts", "scripts/**", "tests/evals/**", "tests/e2e/prepare.ts"],
        rules: {
          "no-console": "off",
        },
      },
      {
        // The modules that own a network boundary, and the operator's scripts.
        files: ["src/organization/graph-api.ts", "scripts/**"],
        rules: {
          "no-restricted-globals": "off",
          "no-restricted-properties": "off",
        },
      },
      {
        // The components own their look, so they style themselves (base-nova
        // writes arbitrary values) and wrap the raw elements.
        files: ["src/components/ui/**"],
        rules: {
          "shadcn/no-restyle": "off",
          "shadcn/no-arbitrary-values": "off",
          "shadcn/require-static-classes": "off",
          "ui/no-bare-label": "off",
          "ui/no-raw-date-format": "off",
          "ui/no-raw-form-element": "off",
          "ui/no-raw-table": "off",
        },
      },
      {
        // The two places a form is drawn, a page's and a dialog's; the pages that are only their form, with
        // no list to return to; the patient's quick registration, a form of its
        // own inside booking; the reply to a patient, under the conversation it answers;
        // and the sandbox's scenario and patient's message, around its conversation.
        files: [
          "src/components/form-page.tsx",
          "src/components/form-dialog.tsx",
          "src/components/patient-form.tsx",
          "src/routes/ingresar.tsx",
          "src/routes/_app/cambiar-contrasena.tsx",
          "src/routes/_app/disponibilidad/index.tsx",
          "src/routes/_app/conversaciones/-hold.tsx",
          "src/routes/_app/whatsapp/configuracion/prueba.tsx",
          "**/*.test.tsx",
        ],
        rules: {
          "ui/no-raw-form": "off",
          "ui/no-uncontrolled-input": "off",
        },
      },
      {
        // The one home of an effect: a hook with a name. shadcn's own components keep theirs.
        files: ["src/hooks/**", "src/components/ui/**"],
        rules: {
          "no-restricted-imports": "off",
        },
      },
      {
        // The select every form uses, which passes a default value through for
        // the forms above that the browser submits.
        files: ["src/components/option-select.tsx"],
        rules: {
          "ui/no-uncontrolled-input": "off",
        },
      },
      {
        // The one place a date is written for a person.
        files: ["src/lib/dates.ts"],
        rules: {
          "ui/no-raw-date-format": "off",
        },
      },
      {
        // The one place a choice from a list is drawn, and the form kit's marked one.
        files: ["src/components/option-select.tsx", "src/components/app-form.tsx"],
        rules: {
          "ui/use-option-select": "off",
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
        // Test code: the tests, their support files and the browser suite.
        files: ["**/*.test.{ts,tsx}", "**/*.test-support.ts", "tests/e2e/**"],
        rules: {
          "tests/no-sleep-poll": "error",
          // Matchers such as `expect.any` are typed `any`.
          "typescript/no-unsafe-argument": "off",
          "typescript/no-unsafe-assignment": "off",
          "typescript/no-unsafe-member-access": "off",
          "typescript/no-non-null-assertion": "off",
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
    ignorePatterns: ["pnpm-lock.yaml", ".claude/worktrees/**", ...vendoredSkills, ...generated],
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
            // Workers AI is remote only: the tests fake transcription at its port, offline.
            remoteBindings: false,
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
