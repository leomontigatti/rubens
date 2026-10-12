# ADR-0004: App tables live in a dedicated `rubens` schema, unprefixed

**Status**: accepted

Date: 2026-10-12

Every app table and enum is created in the `rubens` Postgres schema, under its
plain name (`rubens.user`, `rubens.appointment`), from the first migration.
`public` holds only extensions, `pgboss` the job queue and `drizzle` the
migration journal.

En Escena shows what the alternative costs (leomontigatti/en-escena#506). It
started from a template that prefixed every table (`en_escena_*`) in `public`,
with no ADR. The prefix was then the only thing that kept names like `user` and
`event` from colliding there, so it couldn't be dropped without a schema move.
By the time that was worth doing, the change had grown to 27 tables, 11 enums
prefixed by hand, raw SQL relying on `search_path`, constraint names hard-coded
in error handling, and a test harness that selected tables by prefix. All of
that had to change in one migration, against production.

Doing it on day one costs nothing, so the rules are:

- **Tables and enums** are declared with `rubens.table()` and `rubens.enum()`
  (`src/db/schema/schema.ts`). `pgTable()` and `pgEnum()` would put them in
  `public`, and `tests/db/migrations.db.test.ts` fails if any table lands there.
- **drizzle-kit** reads only `rubens` (`schemaFilter` in `drizzle.config.ts`).
- **Raw SQL qualifies every name.** The connection's `search_path` is not
  changed. A missed qualification then fails loudly instead of resolving
  silently to the wrong place.
- **Constraint names** are Drizzle's defaults, and they carry no prefix. Code
  that matches a constraint by name (for example, mapping a unique violation to a
  form error) is covered by a test, because typecheck cannot see the string.
- **Tests** select tables by schema (`table_schema = 'rubens'`), never by name
  pattern.
- **Grants** to the app role are per schema (`0001_app_role.sql`), so a second
  schema later, if one is ever needed, gets its own explicit grants.
