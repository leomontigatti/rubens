# Research sources

What the shared `research` agent prefers for Rubens' stack.

- **Pinned versions**: `package.json` for the ranges, `pnpm-lock.yaml` for what is installed.
  Read the version before the docs, since TanStack Start, Better Auth and Drizzle move fast.
- **Sources**: the npm registry's JSON (`https://registry.npmjs.org/<name>`), the library's own
  repo (raw files, its docs source), MDN for web platform behaviour, and the PostgreSQL docs for
  the database. The stack and why it was chosen: [ADR-0001](../adr/0001-stack.md).
- **A durable primary source** worth keeping is committed by the calling session under
  `docs/research/<kebab-name>.md`, on its own branch.
