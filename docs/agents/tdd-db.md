# TDD for code that reaches the database

Rubens' facts for the shared `tdd` skill, when a change touches code that queries or writes the
database. The loop, and what not to test, are the skill's.

- **The seam is the function the app calls**: the service function, server function or loader,
  run against a real database. Assert on what it returns and on the rows it leaves; never on the
  SQL it builds or on intermediate state.
- **The database is PGlite, in process**: a `*.db.test.ts` file beside the code, or a
  cross-cutting test under `tests/db/`, run with `pnpm test:db <path>`. Each file gets its own
  instance with every migration applied ([tests/db/README.md](../../tests/db/README.md)).
- **Test as the app role.** A test of a row-level security policy, or of anything tenant-scoped,
  runs as `rubens_app` through the harness's `asAppRole`. As the owner it proves nothing: the
  owner bypasses RLS (ADR-0002).
- **What PGlite cannot show** (LISTEN/NOTIFY, advisory locks across sessions, pooler behaviour)
  needs a check on the local `rubens-postgres` container instead.
- **Fixtures**: one module's rows in `<name>.test-support.ts` beside it, rows shared across
  modules in `src/test-support/`
  ([coding-standards.md](./coding-standards.md#test-support-files)). Extend before adding.
- **A schema change** is `src/db/schema/` plus `pnpm db:generate`, and the generated SQL is
  read before it is committed. An applied migration is never edited.
