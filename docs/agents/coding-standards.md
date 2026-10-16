# Coding standards

These bind every session and every reviewer, human or agent. The principles
come first; the Rubens rules (tenancy, clinical records, patient data) are at
the end and do not bend.

## Testing

Tests verify behaviour through public interfaces, not implementation details.
Code can change internally; a test should fail only when observable behaviour
changes. Name tests for what the system does, not how it does it.

Mock at system boundaries only: external APIs, time and randomness, and file
systems, queues or databases when a real instance is not practical. Do not mock
our own internal collaborators. If code is hard to test without mocking an
internal module, redesign the interface.

Prefer a real database for DB behaviour: `*.db.test.ts` runs on PGlite, in
process, through the same functions the app calls.

Every test names the bug it catches: the wrong implementation that would make it
fail. Tests that cannot name one are not written. The anti-patterns (tautological,
pass-through, restating text, implementation-coupled) and the rules on fixtures and
redundant tests are in the shared `tdd` skill, and this stack's test notes in
[tdd-db.md](./tdd-db.md) and [tdd-frontend.md](./tdd-frontend.md). A test never
asserts that a document contains fixed text; it checks structure against something
outside the document (a link resolves, an index matches its files).

### Test support files

A fixture, builder or request helper that tests share lives in one of two places:

- **One module's tests**: `<name>.test-support.ts`, beside the code it builds for.
- **Tests across modules**: a file in `src/test-support/`.

No other suffix. Before adding a file, extend the one that already builds those
rows or requests.

### Component tests

Test logic and observable behaviour. Do not render components to static markup to
assert props, classes or attributes, and do not test that a callback fired unless
something observable follows. Keep reducers, state machines, validation, formatting
and label logic in pure modules, tested without React, and render-test only a user
flow whose outcome matters (what is submitted, what the user is told, what becomes
disabled) or an accessibility contract (focus, labels, roles). What a component
looks like is checked in the browser ([verification.md](./verification.md)).

A regression test for a real bug stays even when its assertion looks like markup:
the bug is why it exists, and its name should say so.

## TDD

Work in vertical slices: one failing test, the least code that passes it, then the
next behaviour. Do not write a suite of imagined tests before touching the
implementation. Refactor only while green.

## Interface design

Prefer deep modules: small public interfaces that hide real complexity. Scrutinise
optional parameters; they cause bugs by omission. When a service can refuse, return
`{ ok: true, … }` or `{ ok: false, reason }`, with `reason` a short code the caller
maps to copy. The service itself says nothing a user reads.

Accept dependencies instead of constructing external ones inside a module. Return
values rather than hiding behaviour behind side effects.

## Style

Clarity over cleverness: explicit control flow over dense conditionals and nested
ternaries. Comments explain non-obvious intent or a constraint; they do not narrate
the next line. Lint and formatting are the tools' job, not a review comment.

## Code language

The product is Spanish; the codebase is English.

**Spanish for anything a user reads. English for everything else.**

| Layer                                  | Language                         | Example                                    |
| -------------------------------------- | -------------------------------- | ------------------------------------------ |
| UI strings, page titles, URLs          | Spanish                          | `"Nuevo turno"`, `/agenda`                 |
| Code identifiers, comments, docs, ADRs | English                          | `createAppointment`                        |
| Commit messages, PR titles and bodies  | English                          | `feat(agenda): block a room for a range`   |
| Issues and review replies              | English                          | `Add exclusion constraint on appointments` |
| External-system adapters               | the external system's vocabulary | a payment or messaging gateway's own names |

Route filenames are URLs. Where a route segment is Spanish, the symbols it
exports are English. Identifiers follow [GLOSSARY.md](../../GLOSSARY.md): a term
there names the code concept, and its `ui:` value is the copy the user reads.

Spanish inside English prose appears only as data, in backticks, as the copy or
the term a comment or doc is about. A bare Spanish noun in an English sentence is
the same mistake as a Spanish identifier. A thrown `Error` is engineering prose,
so its message is English. A user-facing refusal is a structured result, never a
thrown `Error`.

Do not translate existing comments you are not otherwise touching.

## Errors and catches

A `catch` that turns a failure into user copy hides it from everyone else. It
either tests the condition it expects and rethrows the rest, or logs a tagged line
before converting, with ids and never patient data. A bare `catch {}` needs the
expected condition in the code or a one-line reason.

## Rubens rules

These come from [ADR-0002](../adr/0002-tenancy-and-database-connections.md) and
[ADR-0003](../adr/0003-scheduling-and-clinical-records.md). The ADRs say why.

- **Tenant queries go through `withTenant()`** (`src/db/tenant.ts`) and nothing
  else. It sets the tenant with `set_config(..., true)`, transaction-local. Never
  a session-level `SET`, a `LISTEN`, a session advisory lock or a long-lived named
  prepared statement: a pooler hands the connection to another organization next.
  Lint enforces the entry point: importing the `db` client (`#/db/client.ts`, by
  alias, relative path or dynamic `import()`) fails outside `src/db/`,
  `src/lib/auth.ts` (Better Auth's tables are not tenant-owned) and `tests/db/`.
  Because of that exemption, `src/db/` holds only the client, `withTenant`, the
  schema and the migrations: a feature's queries live with the feature.
- **Row-level security is the boundary.** The UI and the server functions are not.
  A test of an RLS policy runs as `rubens_app`, which owns nothing and has no
  `BYPASSRLS`; as the owner it proves nothing.
- **Instants are `timestamptz`.** Local times are derived from the office's IANA
  time zone, never stored as a bare `timestamp`.
- **Clinical notes are append-only.** An edit is a new version that supersedes the
  old one. No `UPDATE` or `DELETE` on clinical notes or the audit log.
- **No patient data in logs, errors, or job payload logs.** Names, phone numbers,
  appointment times and clinical text stay out of `console`, error messages and
  pg-boss payload logs. Ids are enough to find a record.
- **Migrations are raw SQL where Drizzle stops**, and an applied migration is never
  edited.
- **Tables and enums live in the `rubens` schema, unprefixed** (ADR-0004): declare
  them with `rubens.table()` and `rubens.enum()` from `src/db/schema/schema.ts`,
  never `pgTable()` or `pgEnum()` (lint rejects both). Raw SQL qualifies every name (`rubens.user`)
  instead of relying on `search_path`, and code that matches a constraint by name
  (a unique violation, say) is covered by a test, because typecheck cannot see it.

## Stack notes

- Imports use the `#/` alias for `src/` and carry explicit `.ts` or `.tsx`
  extensions.
- Route files in `src/routes/` are the TanStack Router file routes; the generated
  `src/routeTree.gen.ts` is committed, not edited.
- Validate input with Zod 4, one schema for the form and the server function.
- Tenant-owned tables are read and written only inside `withTenant()`. The `db`
  client it wraps is not called directly for them.
- pg-boss connects through `DATABASE_DIRECT_URL` (ADR-0002); see `src/server/jobs.ts`.
