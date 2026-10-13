# Scripts

Every script in `package.json`, one line each. ⚠️ marks a script that writes to a
database or deletes or rewrites files. The script names are a contract: CI, the git
hook and the Dockerfile call them by name, so renaming one means editing those too.

Scripts that call `scripts/*.ts` run under `tsx`. The `db:*` scripts load `.env` and
then `.env.local` (`node --env-file-if-exists`), so a worktree's own database wins.

## Development

- `dev`: `scripts/worktree-db.ts ensure` (creates this worktree's database and port on
  first use), then `vp dev`, the dev server on `PORT` (default 3000). Strict port: if
  the port is taken, it fails rather than moving.
- `dev:stop`: stops the dev server this worktree runs, by port and working directory.
  It does not touch other worktrees' servers, and exits 1 if the port is held from
  outside this worktree.
- `start`: `node .output/server/index.mjs`, the production build served locally. Run
  `build` first.
- `routes:generate` ⚠️ rewrites `src/routeTree.gen.ts` from the route files. Generated,
  so only ever regenerate it, never edit it.

## Build and checks

- `build`: `vp build`. Produces `.output/` (Nitro, node preset). The Dockerfile runs it.
- `check`: `vp check`: format check, lint and typecheck. This is what CI runs.
- `check:fix` ⚠️ `vp check --fix`: rewrites files in place to fix what it can.
- `typecheck`: `vp check --no-fmt --no-lint`. Typecheck only; the pre-commit hook runs it.
- `lint`: `vp lint`, Oxlint with the type-aware rules configured in `vite.config.ts`.
- `format`: `vp fmt`. Rewrites files in place.
- `format:check`: `vp fmt --check`. Reports, changes nothing.
- `check:migrations`: the three migration rules (immutability, order, safety) against
  `origin/main`. Fetch that ref first. CI runs it.
- `check:dependency-audit`: fails on high and critical advisories this branch
  introduces, against `origin/main`. CI runs it.
- `check:fallow`: `fallow audit` gated on what this branch adds against `origin/main`
  ([fallow.md](../agents/fallow.md)). The pre-commit hook and CI run it.
- `check:pr-title`: the conventional-commit prefix and English subject rule, over the
  `PR_TITLE` environment variable. CI runs it on PR events.

## Tests

- `test`: `test:unit` then `test:db`.
- `test:unit`: `vp test --run --project unit`, the `*.test.ts(x)` files. No database.
- `test:db`: `vp test --run --project db`, the `*.db.test.ts` files on PGlite, an
  in-process Postgres. No database service needed.

## Database

- `db:generate` ⚠️ runs `drizzle-kit generate`: diffs `src/db/schema` against the
  snapshots and writes a new migration under `src/db/migrations`. Offline; connects to
  nothing. Commit what it writes, and never edit a migration that is already on `main`.
- `db:migrate` ⚠️ runs `scripts/worktree-db.ts ensure`, then `scripts/migrate.mjs`,
  which applies every pending migration to the database named by `DATABASE_DIRECT_URL`
  (or `DATABASE_URL`). Whatever those variables point at gets migrated, so check them
  before running it against anything but this worktree's database.
- `db:studio` ⚠️ runs `drizzle-kit studio` on the owner URL (`DATABASE_DIRECT_URL`),
  which bypasses row-level security. It is a read-write web UI over the data. Use it
  against a local or worktree database only.
- `db:worktree`: `scripts/worktree-db.ts`. With no argument, sets up this worktree's
  database and `.env.local` (its own database name and port). With `ensure`, the same
  setup, skipped when it is already done. The `prune` function that drops the databases
  of removed worktrees exists, but no CLI calls it, so this script never drops a
  database.

## Lifecycle

- `prepare`: `vp config --no-agent || true`. Runs on every `pnpm install`. Installs the
  Vite+ git hook dispatcher into `.git`. Skip it with `VP_GIT_HOOKS=0`, or turn hooks off
  for a clone with `vp hooks disable` (`docs/operations/local-development.md`).
