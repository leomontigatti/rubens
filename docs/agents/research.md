# Research sources

What the shared `research` agent prefers for underthing's stack.

- **Pinned versions**: `package.json` for the ranges, `pnpm-lock.yaml` for what is installed.
  Read the version before the docs, since TanStack Start, Clerk, Wrangler and Drizzle move fast.
- **Sources**: the npm registry's JSON (`https://registry.npmjs.org/<name>`), the library's own
  repo (raw files, its docs source), MDN for web platform behaviour, Cloudflare's Workers and Durable
  Objects docs for the runtime, and the SQLite docs for the object's storage. The stack and why it was chosen: [ADR-0001](../adr/0001-stack.md).
- **A durable primary source** worth keeping is committed by the calling session under
  `docs/research/<kebab-name>.md`, on its own branch.
