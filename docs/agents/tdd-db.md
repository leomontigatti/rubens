# TDD for code that reaches the organization's data

underthing's facts for the shared `tdd` skill, when a change touches code that reads or writes an
organization's data: the organization object's methods and the area modules in
`src/organization/`. The loop, and what not to test, are the skill's.

- **The seam is the object's method**, called through its stub the way a server function calls
  it: `organization.<method>(caller, input)`. Assert on what it returns (the result or the
  refusal) and on what a later method call reads back; reach into storage with `inStorage()` only
  for what no method shows (an audit entry, a row a method never returns). Never assert on the
  SQL an area function builds.
- **The storage is real**: a `*.workers.test.ts` file beside the code, run in the Workers runtime
  with `pnpm test:workers <path>`. Each object gets SQLite storage of its own, with every
  migration applied when it starts, so a test that calls `setUpTestOrganization()` or
  `freshOrganization()` shares no data with any other.
- **Authorization is part of the behaviour.** The object checks the caller against its own member
  table on every call, so a method's tests cover the roles it refuses (`forbidden`), an unknown
  or deactivated caller (`unauthenticated`), and a member who must still change their password,
  through members added with `addMember()` / `addStaff()`.
- **Races inside the object are not tested with concurrency**: an object runs one event at a
  time and an area function writes in one synchronous transaction, so a check and its write
  cannot interleave. A browser-only race (a save and a navigation) belongs to the browser suite
  ([tests/e2e/README.md](../../tests/e2e/README.md)).
- **Clerk is faked**: `fakeAccounts` (with `vi.mock` of `#/organization/accounts.ts`) stands in
  for Clerk's Backend API; a test asserts on the users and metadata it holds.
- **Meta is faked at its HTTP boundary**: `fakeMeta`, with `vi.mock` of
  `#/organization/graph-api.ts` passing its `fetch` to the real `whatsappCloudFor` and
  `metaSignupFor`, its `settings` in place of the Worker's configured test number and its
  `signupSettings` to Embedded Signup, so a test asserts on the requests Meta received and
  picks Meta's answer (`answerWith`, or `answerNextWith` for one request), holds a request
  (`holdNext`) to run another call meanwhile, lists the account's templates from
  `templatesAtMeta`, sets the number signup connects (`signupNumber`) and a refusal at
  any of its steps (`signupRefusals`), and sets or unsets the WhatsApp settings per test.
  The factory reads `fakeMeta` only inside the functions it returns: `vi.mock` is hoisted
  above the imports. The Worker's WhatsApp directory is real: `whatsappDirectory()`
  reads what an object wrote, and `freshWhatsappDirectory()` is one of a test's own.
- **The alarm** runs when a test calls `runDurableObjectAlarm(organization)`. The runtime also
  fires a due alarm by itself, racing the test, so a test that sends from the outbox fakes the
  object's clock (`vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime`) to a time
  before the real one, which keeps what it queues in the scheduler's future
  (`src/organization/outbox.workers.test.ts`).
- **Fixtures**: `src/organization/organization.test-support.ts` (`setUpTestOrganization`,
  `adminCaller`, `addMember`, `addRefusedAdmin`, `addStaff`, `addOffice`, `addRoom`, `setUpBookingWorld` with its
  `appointmentOf`, `at`, `expectOk`, `inStorage`, `auditEntriesFor`, `fakeAccounts`, `fakeMeta`). Extend it before adding another support file
  ([coding-standards.md](./coding-standards.md#test-support-files)).
- **A schema change** is `src/organization/schema.ts` (or `whatsapp-schema.ts`) plus `pnpm organization:generate`, and the
  generated SQL is read before it is committed. A migration on `main` is never edited.
