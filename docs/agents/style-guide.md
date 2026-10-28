# Style guide

The judgement calls of the interface, written with the first screens, one decision at a time,
each with the reason and a component that gets it right.

The mechanical rules live in `pnpm lint`, each message carrying its reason: `@shadcn/lint`'s
rules and the repo's `ui` plugin (`scripts/oxlint-ui-plugin.mjs`), configured in
`vite.config.ts` and tested in `tests/lint/ui-rules.test.ts`. Where they disagree with this
page, they are current. Why a linter and not only this page:
[design-system-enforcement.md](../research/design-system-enforcement.md).

What is settled already:

- The base is shadcn/ui on Tailwind 4, in the `base-nova` style, on Base UI (see [shadcn.md](./shadcn.md)).
- The UI is Spanish; the copy is written with the user's terms from `GLOSSARY.md`
  (the `ui:` values), not with code identifiers.
- **Tokens and variants before classes.** A colour, radius or state comes from a token or a
  component variant, and `className` is for layout. A component in `src/components/ui` keeps
  its look: pick a `variant` or `size`, never restyle it from a screen. A case with no token
  gets a one-off class; a second case gets a variant or a component. A new token, variant or
  typeface is a product decision: ask before adding one.
- **An existing component before new markup.** Look in `src/components/ui` and the shared
  components in `src/components/` ([codebase-map.md](./codebase-map.md#layout)) before writing
  one; extend one with a variant rather than copy its markup. A shadcn component the screen
  needs is added with the CLI ([shadcn.md](./shadcn.md)), never written by hand.
