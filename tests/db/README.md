# DB tests

`pnpm test:db` runs the `*.db.test.ts` files under `src/` and `tests/db/`
against PGlite, an in-process Postgres. Each file gets its own instance with
every migration in `src/db/migrations` applied, so files run in parallel and
need no server.

- `harness.ts` creates the instance (`createTestDatabase`), loads `btree_gist`
  because migration 0000 needs it, and runs a callback as the app role
  (`asAppRole`, `SET LOCAL ROLE rubens_app`, which ends with the transaction).
- Row-level security is only tested as `rubens_app`. The owner role bypasses
  RLS (ADR-0002), so a test that runs as the owner proves nothing about it.

PGlite is a fast path, not a replacement for production Postgres. Anything that
depends on a server feature PGlite lacks (LISTEN/NOTIFY, advisory locks across
sessions, pooler behaviour) needs a real-Postgres check. The local
`rubens-postgres` container is the one to use for that.
