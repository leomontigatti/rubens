# Coding standards

These bind every session and every reviewer, human or agent. The principles
come first; the underthing rules (tenancy, clinical records, patient data) are at
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

A test that waits for something the code under test does awaits a promise
resolved on the event, never a timer polled in a loop: the lint rule
`tests/no-sleep-poll` rejects the loop in test code.

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

A network call goes through the module that owns its boundary, which takes a
`Fetcher` its tests inject: Meta's Graph API through `src/organization/graph-api.ts`
(`whatsappCloudFor`, `metaSignupFor`). A new external service gets a module of its
own. Lint rejects the global `fetch` anywhere else (`no-restricted-globals` and
`no-restricted-properties`); the boundary modules and `scripts/` are the override
that turns both off in `vite.config.ts`, and a new boundary module is added there.

## Type assertions

An assertion (`value as T`, `<T>value`) tells the type checker to stop checking, so
a wrong shape gets through silently. Narrow instead: a type guard (`value is T`), a
schema parse where data enters from outside, or a typed helper that keeps the one
check every caller needs. `as const` is not an assertion and stays.

A non-null assertion (`value!`) is an assertion too: lint rejects it in `src/` and
`scripts/` (`typescript/no-non-null-assertion`) and allows it in test code. Narrow
with a check, destructure or `for…of` instead of indexing, or, where the value is a
real invariant (a row just written, a key the map was built from), `present` from
`src/lib/present.ts`, which throws an `Error` stating it.

Lint rejects assertions (`typescript/consistent-type-assertions`, `never`) everywhere
but the files in `scripts/type-assertion-allowlist.json`, each with the count it may
hold; `vite.config.ts` builds the override that turns the rule off from that list. It
has two parts, held to their counts alike:

- `sharedUtilities`: the files that exist to hold a cast for their callers, today
  only `src/dev/accepted.ts`.
- `files`: every other file that held assertions when the rule landed.

The list only falls. `pnpm check:type-assertions` (pre-commit and CI) fails when a
file's count differs from its entry, when an entry is new or higher than on
`origin/main`, when the override names any other file, on a disable comment that
names the rule or no rule (the rule takes none), and on a file it cannot parse. So a
helper that needs a cast to remove many keeps it in a file already on the list, within
that file's entry. A file renamed or moved is a new path to the list, so it moves
without its assertions. To
lower an entry, remove the assertions and run `pnpm check:type-assertions --write` in
the same change: it rewrites the counts from the tree and drops a file at zero.

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
either tests the condition it expects and rethrows the rest, or logs it before
converting, with ids and never patient data. The app logs only through
`src/lib/log.ts` (lint bans `console` elsewhere in `src/`): `log.error(tag, message,
fields)`, with a caught value as `errorClass(error)`, since its message can quote
patient data. A bare `catch {}` needs the
expected condition in the code or a one-line reason.

## underthing rules

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
- **A method is one line**: `this.as(caller, requirement, (acting) => …)` into an
  area module in `src/organization/`. The runtime sets the object's alarm after any
  call that opened a transaction, so no method chooses whether to set it; a job is
  one `Job` value (`src/organization/jobs.ts`) in the runtime's `jobs` list. The
  area function is synchronous and makes its writes, its checks and its audit entry
  (`recordAudit()`) in one `database.transaction`, with no `await` inside (a write
  outside one is missed by the alarm): an object runs one event at a time,
  so a check and the write it guards cannot be raced (double booking, ADR-0003).
  The one exception is a call to an outside service (Clerk, Meta), which cannot sit
  inside a synchronous transaction: the area function checks, awaits the call, then
  makes the write and its audit entry in one transaction. While the call is awaited
  the object takes other events, so when what it checked depends on stored state, a
  per-object in-flight set refuses a second call for the same key until the first
  settles, as `emailsInFlight` does for `createStaffMember` in
  `src/organization/staff.ts`.
- **A query binds at most 100 parameters** in the object's SQLite, and throws past
  that. A list that grows with the organization's data (members, patients, messages,
  templates) is inserted a row per statement, as `notify()` in
  `src/organization/notifications.ts` does, and reaches an `inArray` as a subquery,
  never as an array of ids: the query that reads it, as `patientsReachedAt` in
  `src/organization/whatsapp-messages.ts` is, or, for a list only held in memory (a
  turn's messages, a webhook's statuses), `boundAsOne` in `src/organization/database.ts`.
- **Instants are integers**, Unix milliseconds in UTC; a span is `[start, end)`.
  Local times are derived from the practice's zone, `practiceTimeZone` in
  `src/lib/dates.ts`, never stored bare.
- **Clinical note versions are append-only** (ADR-0005). Editing a note adds a
  version. No update or delete of a note version or the audit log, and no delete of
  any clinical data, except an admin deleting voided content: a voided file's content
  is removed and its note kept, and a voided note's versions have their text cleared,
  the only change allowed on a version. The object's methods are the only writers,
  so they are where these rules are checked and tested.
- **No patient data in logs or errors.** Names, phone numbers, appointment times and
  clinical text stay out of logs and error messages. Ids are enough to find a
  record.
- **The object's schema is `src/organization/schema.ts`**, with its WhatsApp tables in
  `whatsapp-schema.ts`, and its migrations are
  generated from it (`pnpm organization:generate`) into `src/organization/migrations/`,
  which every object applies on start. A migration on `main` has run in deployed
  objects: it is never edited, and a schema change adds a new one.

## React

An effect lives in a named hook in `src/hooks`, never inline in a component or a
route. What an effect would do usually belongs elsewhere: in the event handler that
caused it, in state derived during render, in the route's loader, or, for markup
that must exist first, in a ref callback or `autoFocus`. What is left (a
subscription, a timer, focus after a render the code cannot reach from a handler)
is a hook with a name that says what it is for, in `src/hooks`. The lint rule
`no-restricted-imports` in `vite.config.ts` rejects `useEffect`, `useLayoutEffect`,
`useInsertionEffect` and React's default and namespace imports, which reach them,
everywhere but `src/hooks/` and shadcn's `src/components/ui/`. It takes no disable
comment.

## Stack notes

- Imports use the `#/` alias for `src/` and carry explicit `.ts` or `.tsx`
  extensions.
- Route files in `src/routes/` are the TanStack Router file routes; the generated
  `src/routeTree.gen.ts` is committed, not edited.
- Validate input with Zod 4, one schema for the form and the server function.
- The organization's data is read and written only by the object's methods, never by
  a server function or a route.
