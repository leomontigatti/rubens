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

Prefer real storage for data behaviour: `*.workers.test.ts` runs the organization
object's methods in the Workers runtime, on the object's own SQLite, through the
same calls the server functions make.

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

`pnpm check:comment-language` enforces this over the whole tree, docs included:
in code, double-quote UI copy and backtick a name; in markdown, backtick both.
`docs/adr/`, `docs/research/` and the WhatsApp templates are records and exempt.

A source file under `src/` stays below about 5,500 tokens (22 KB), the size an
agent reads whole; `pnpm check:file-tokens` fails one above it. Split at a module
boundary, not by moving half the functions to a `-2` file.

## Errors and catches

A `catch` that turns a failure into user copy hides it from everyone else. It
either tests the condition it expects and rethrows the rest, or logs a tagged line
before converting, with ids and never patient data. A bare `catch {}` needs the
expected condition in the code or a one-line reason.

## Rubens rules

These come from [ADR-0008](../adr/0008-cloudflare-workers-one-object-per-organization.md),
[ADR-0009](../adr/0009-staff-sign-in-through-clerk.md) and
[ADR-0003](../adr/0003-scheduling-and-clinical-records.md). The ADRs say why.

- **The organization's object is the tenant boundary.** A server function reaches
  data only through `withOrganization()` (`src/server/with-organization.ts`), which
  takes the organization and the caller from the verified session
  (`src/server/caller.ts`), never from the request body, and calls that
  organization's object (`src/organization/organization.ts`) and only it.
- **The object authorizes every call** from its own member table (`authorize()` in
  `src/organization/members.ts`), not from the token's roles: each method states its
  requirement, so a removed member or a changed role takes effect on the next call.
  The UI and the server functions are not the boundary.
- **A method is one line**: `this.#as(caller, requirement, (acting) => …)` into an
  area module in `src/organization/`. The area function is synchronous and makes its
  writes, its checks and its audit entry (`recordAudit()`) in one
  `database.transaction`, with no `await` inside: an object runs one event at a time,
  so a check and the write it guards cannot be raced (double booking, ADR-0003).
- **Instants are integers**, Unix milliseconds in UTC; a span is `[start, end)`.
  Local times are derived from the office's IANA time zone, never stored bare.
- **Clinical note versions are append-only** (ADR-0005). Editing a note adds a
  version. No update or delete of a note version or the audit log, and no delete of
  any clinical data, except an admin deleting voided content: a voided file's content
  is removed and its note kept, and a voided note's versions have their text cleared,
  the only change allowed on a version. The object's methods are the only writers,
  so they are where these rules are checked and tested.
- **No patient data in logs or errors.** Names, phone numbers, appointment times and
  clinical text stay out of `console` and error messages. Ids are enough to find a
  record.
- **The object's schema is `src/organization/schema.ts`**, and its migrations are
  generated from it (`pnpm organization:generate`) into `src/organization/migrations/`,
  which every object applies on start. A migration on `main` has run in deployed
  objects: it is never edited, and a schema change adds a new one.

## Stack notes

- Imports use the `#/` alias for `src/` and carry explicit `.ts` or `.tsx`
  extensions.
- Route files in `src/routes/` are the TanStack Router file routes; the generated
  `src/routeTree.gen.ts` is committed, not edited.
- Validate input with Zod 4, one schema for the form and the server function.
- The organization's data is read and written only by the object's methods, never by
  a server function or a route.
