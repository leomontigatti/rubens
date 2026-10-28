# Design-system enforcement for agents

How other repositories make coding agents reuse their components and tokens, and check it
before a commit. Researched 2026-10-28, for the first screens on `base-nova`. What Rubens does
with it: [style-guide.md](../agents/style-guide.md).

## What others do

| Repository                                                                                                    | Tells agents to reuse                                                                                                                                                        | Checks it                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [mattpocock/course-video-manager](https://github.com/mattpocock/course-video-manager/blob/3965c45f/CLAUDE.md) | No. shadcn in `components/ui`, tokens in `app.css`'s `@theme`.                                                                                                               | No lint or hook. Every visible change is checked in the browser before the PR, and the PR body says what was clicked and seen.                                                                                                           |
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code/blob/5211acfe/AGENTS.md)                               | `components/ui` exports "own their look. Pick a `variant` or `size`; do not restyle one with `className`." `docs/internals/web-ui.md`: compose or extend, never copy markup. | `@shadcn/lint`'s `shadcn/no-restyle` as an error in `vite.config.ts` (Vite+, like Rubens), run in CI.                                                                                                                                    |
| en-escena (the user's other project)                                                                          | A style guide naming the shared component for each case; a new token or variant is a product decision.                                                                       | A custom Oxlint JS plugin of about ten rules (`no-raw-form-element`, `no-restyle`, dialog and alert structure, wording), a regex script over raw palette colours, and ADR-0015: anything a tool can decide is an error, never a warning. |
| [shadcn/ui's agent skill](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/rules/composition.md)       | Which component fits which pattern (`Alert`, `Empty`, `Badge`, `Skeleton`).                                                                                                  | No.                                                                                                                                                                                                                                      |
| [Supabase](https://github.com/supabase/supabase/blob/master/.agents/skills/studio-ui-patterns/SKILL.md)       | A skill pointing at the design-system docs and a demo before composing UI.                                                                                                   | No.                                                                                                                                                                                                                                      |

None of them catches a new component that duplicates an existing one: that stays with the
docs and the review.

## Tools

- **[`@shadcn/lint`](https://github.com/shadcn-ui/lint)**, 0.2.3 (2026-10-19), ~1.8M weekly
  downloads. shadcn's linter for Tailwind 4 design systems, for ESLint and Oxlint 1.80+. Rules:
  `no-restyle` (per-component contracts of what a `className` may change), `no-raw-colors`,
  `no-arbitrary-values`, `no-inline-styles`, `no-unknown-classes`, `require-static-classes`. It
  reads the components and theme from `components.json`, follows Base UI's `render`, and each
  error names what to use instead. Its authors' evals: agents reached zero violations in one
  correction round, at 10–48% less cost than with written rules alone.
- **[`eslint-plugin-better-tailwindcss`](https://github.com/schoero/eslint-plugin-better-tailwindcss)**,
  4.10.0: Tailwind 4 class validation and restriction, Oxlint-compatible. Overlaps
  `@shadcn/lint` except for class ordering; no per-component restyle rule.
- **Vendor plugins** (Atlassian `@atlaskit/eslint-plugin-design-system`, Shopify
  `stylelint-polaris`, Primer, GitLab): tied to their own tokens and components; models to copy,
  not to install.
- **Tailwind 4 `@theme { --color-*: initial }`** removes the default palette, so `bg-red-500`
  stops existing; arbitrary values (`bg-[#123]`) still need a lint rule.
- **Oxlint** has `no-restricted-imports` and `react/forbid-dom-props` built in, but no rule
  for a raw `<button>` outside a directory: that takes a JS plugin rule. JS plugins are alpha.
- **shadcn MCP / registry, Storybook MCP** (preview): help an agent find components; they
  check nothing.
- **Playwright screenshot tests** catch visual drift, at the cost of baselines to keep; they do
  not say which component to use.
