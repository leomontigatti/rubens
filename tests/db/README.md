# DB tests

`pnpm test:db` runs the `*.db.test.ts` files under `src/` and `tests/db/`
against PGlite, an in-process Postgres. Each test file gets its own instance
with every migration in `src/db/migrations` applied, emptied before each of its
tests, so tests and files are isolated, files run in parallel, and nothing needs
a server.

- `global-setup.ts` migrates one instance before the run and saves its data
  directory, trimmed to under 18 MB; booting from that copy takes about 0.4 s,
  against 3 to 5 s to migrate from scratch. A new migration is picked up on the
  next run, with nothing to regenerate.
- A file calls `sharedTestDatabase()` once and `reset()` in its `beforeEach`.
  The first `reset()` boots the instance; each later one truncates every table
  in the `rubens` schema and discards session state, about 0.05 s. A file closes
  its instance after its last test. Booting per test cost half the suite's time.
- Outside CI, two files run at a time (`maxWorkers` in `vite.config.ts`). Each
  worker holds its app modules and a PGlite instance, and agent threads on one
  machine share one memory limit: before the cap, Vitest's default gave the
  dev laptop seven workers, and threads running the suite beside each other
  were killed for memory. More workers gave no speed on its 4 cores.
- Files share a worker's loaded modules (`isolate: false` in `vite.config.ts`):
  a test that mocks a module, stubs a global or fakes timers undoes it in its
  own `afterEach`, or the next file in that worker inherits it.
- `createTestDatabase()` boots a separate instance, for a test that needs two
  databases at once; the caller closes it.
- `harness.ts` creates the instance (`createTestDatabase`), loads the contrib
  extensions the migrations create (`extensions.ts`: `btree_gist`, `unaccent`,
  `pg_trgm`), and runs a callback as the app role
  (`asAppRole`, `SET LOCAL ROLE rubens_app`, which ends with the transaction).
- Row-level security is only tested as `rubens_app`. The owner role bypasses
  RLS (ADR-0002), so a test that runs as the owner proves nothing about it.

PGlite is a fast path, not a replacement for production Postgres. Anything that
depends on a server feature PGlite lacks (LISTEN/NOTIFY, advisory locks across
sessions, pooler behaviour) needs a real-Postgres check. The local
`rubens-postgres` container is the one to use for that.
