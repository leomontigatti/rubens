# Local development

From a fresh clone to a running dev server, and the git hook. No database, no keys
and no account: Miniflare runs the Worker and the organization objects locally
([ADR-0008](../adr/0008-cloudflare-workers-one-object-per-organization.md)).

## Prerequisites

- **Node 22.23.4**, from `.nvmrc` (`fnm use` or `nvm use` reads it).
- **pnpm**, the version in `packageManager`. Run `corepack enable` once, and pnpm
  picks the right version from the repo.
- **Vite+ (`vp`)** is a dev dependency, so `pnpm <script>` and `pnpm exec vp` find it.
  A global install is optional.
- **Git 2.32 or later**, for `vp staged` in the pre-commit hook.
- **gitleaks 8.30.1**: the pre-commit hook runs it when present, and only warns otherwise;
  CI runs it blocking, but the repo is public, so a leak CI catches is already pushed.
  Install instructions:
  `docs/operations/ci.md`, "Running the gates locally".

## First run

```sh
pnpm install                       # runs `prepare`, which installs the git hooks
pnpm dev                           # http://localhost:3000, or this worktree's port
```

With no Clerk key, the app signs in through the **dev sign-in**: `/ingresar` lists the
dev organization's seeded members (`src/dev/world.ts`), and picking one signs in as
them. The dev organization is seeded on the sign-in page's first load
(`src/dev/seed.ts`). Its data lives in `.wrangler/state/`; deleting that folder starts
from a fresh seed.

Everything runs offline: the dev server and the built Worker start with remote
bindings off, so Workers AI's `AI` binding, which transcribes voice notes, is not
reached, and a voice note waits untranscribed as it would while Workers AI is down.
The object's tests fake transcription at its port.

`.env` is optional and gitignored. `.env.example` lists every variable the app reads:
the port, and the Clerk keys to sign in through Clerk locally instead of the dev
sign-in.

`pnpm install` installs the git hook dispatcher through `prepare`. To install without
hooks (for example in CI or a container), set `VP_GIT_HOOKS=0`.

## One port per worktree

The main checkout serves on port 3000. Each linked worktree (`git worktree add`) gets
its own port, written to a gitignored `.env.local` by `scripts/worktree-port.ts`, which
`pnpm dev` runs first. The port is chosen from the worktree's folder name and kept
across runs; a port another worktree already claims is skipped. The browser suite
serves on that port plus 10,000 (`tests/e2e/environment.ts`), so concurrent sessions'
servers never collide. Each worktree keeps its own `.wrangler/` state.
`pnpm dev:url` prints the checkout's dev URL, writing the port first the way `pnpm dev`
does when none is written yet.

## The organization's schema

The object's schema is `src/organization/schema.ts`, with its WhatsApp tables in
`whatsapp-schema.ts`. Its migrations are generated from
it and committed under `src/organization/migrations/`; every object applies the ones it
has not run when it starts.

1. Change the schema.
2. `pnpm organization:generate`: writes the migration. It connects to nothing.
3. Restart `pnpm dev`, or run `pnpm test:workers`, to apply it.

A migration on `main` has run in deployed objects: never edit it; a schema change adds
a new one.

## Tests

- `pnpm test:unit`: the `*.test.ts(x)` files.
- `pnpm test:workers`: the `*.workers.test.ts` files, in the Workers runtime, each file
  on real SQLite storage of its own ([tdd-db.md](../agents/tdd-db.md)).
- `pnpm test`: both.
- `pnpm test:e2e`: the browser suite against the production build
  ([tests/e2e/README.md](../../tests/e2e/README.md)).

## The git hook

`.vite-hooks/pre-commit` runs on every commit:

1. gitleaks over the staged diff (`.gitleaks.toml`); it warns and continues when the binary
   is missing;
2. `vp staged`, which runs `vp check --fix` on the staged files (the `staged` block in
   `vite.config.ts`), and re-stages what it fixed;
3. `pnpm typecheck` over the whole project;
4. `pnpm check:fallow`, against `origin/main` ([fallow.md](../agents/fallow.md));
5. the whole-tree checks CI also runs, each under two seconds: `pnpm check:comment-language`,
   `pnpm check:labels` and `pnpm check:file-tokens`.

Any failure stops the commit. To check that the hook is installed in this clone:

```sh
pnpm exec vp hooks status
```

`core.hooksPath` should read `.vite-hooks/_`. To turn hooks off in this clone only,
`pnpm exec vp hooks disable`; `pnpm exec vp hooks enable` turns them back on. Hooks
can be skipped with `git commit --no-verify`, which is why CI runs the same checks
blocking.

## Running the production build locally

```sh
pnpm build
pnpm exec wrangler dev --local --var DEV_SIGN_IN:true   # the built Worker, with the dev sign-in
```

A build has no dev server, so without a Clerk key it refuses to serve unless
`DEV_SIGN_IN` is `true`; the browser suite runs it that way. A deployed Worker never
sets it ([infrastructure.md](./infrastructure.md)).

## Stopping

`pnpm dev:stop` stops this worktree's dev server, by its port.
