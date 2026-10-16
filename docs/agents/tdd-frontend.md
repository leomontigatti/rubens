# TDD for frontend state

Rubens' facts for the shared `tdd` skill, when a change touches a reducer, a state machine,
derived state or a multi-step UI flow.

- **The seam is a pure module**: the state logic (transitions, derived values, helpers) in its
  own file beside the feature, such as `my-feature-reducer.ts`, with its test beside it
  (`my-feature-reducer.test.ts`, run with `pnpm test:unit <path>`). Given a state and an input,
  assert on the state it returns; no React.
- **No reducer library is prescribed.** A change that introduces one keeps the logic in that
  pure module whatever primitive it picks, and records the choice in an ADR if it becomes a
  repo-wide convention.
- **Wire last.** The component stays thin: it dispatches and renders. Check the wired component
  in the browser ([verification.md](./verification.md)), not with a jsdom render that restates
  its markup. A component test is only for a user flow whose outcome matters or an
  accessibility contract ([coding-standards.md](./coding-standards.md#component-tests)).
