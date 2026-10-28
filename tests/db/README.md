# DB tests

`pnpm test:db` runs the `*.db.test.ts` files under `src/` and `tests/db/`
against PGlite, an in-process Postgres. Every `createTestDatabase()` call is
its own instance with every migration in `src/db/migrations` applied, so tests
and files are isolated, files run in parallel, and nothing needs a server.

- `global-setup.ts` migrates one instance before the run and saves its data
  directory; `createTestDatabase` loads that copy (about 0.7 s) instead of
  migrating from scratch (3 to 5 s). A new migration is picked up on the next
  run, with nothing to regenerate.
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
