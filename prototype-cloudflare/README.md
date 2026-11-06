PROTOTYPE, throwaway: answers whether rubens fits Cloudflare Workers

# rubens on Cloudflare Workers: feasibility prototype

Only the agenda slice: organizations, members with roles (admin, receptionist,
practitioner), practitioners, rooms, patients and appointments with a `[start, end)`
span. Nothing here is meant to be merged into `src/`.

## Run it

```sh
pnpm install
pnpm dev          # http://localhost:5173, no .env, no Cloudflare account
pnpm seed         # in a second terminal, while dev runs
```

With no Clerk key (a fresh clone), `/ingresar` is a dev sign-in: pick one of the seeded staff,
no password. With `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` in `.dev.vars` (gitignored), it
is Clerk's `<SignIn/>`, and `pnpm seed` creates the staff in Clerk: `admin+clerk_test@example.com`,
`p1+clerk_test@example.com` … `p4+clerk_test@example.com`, password `rubens-dev-password`; a
new-device check takes the code 424242. The agenda is `/agenda?week=2026-11-02`.

Other scripts, against the running dev server:

- `node scripts/concurrency.mjs practitioner|room|room-overbooking [n]`: n concurrent bookings, counted.
- `CLERK_TOKEN=<session JWT> node scripts/concurrency.mjs …`: the same, as a Clerk user.
- Every response carries `Server-Timing`: Worker wall time, Durable Object calls, SQLite rows
  read and written, and D1 queries.

`/api/dev/*` answers 404 in a production build.

## Shape

| Piece       | Where                                              | What                                                                                                                                                        |
| ----------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker      | `src/server.ts`                                    | TanStack Start's handler, wrapped for `Server-Timing`; exports the Durable Object class                                                                     |
| Auth        | `src/start.ts`, `src/lib/identity.ts`              | **Clerk** (`clerkMiddleware`, `<SignIn/>`): users and sessions live in Clerk; each user's organization id and rubens roles in its public metadata, carried in the session token's `org` and `roles` claims. Clerk Organizations are off. No key: a dev sign-in |
| Clinic data | `src/org/organization-data.ts`                     | `OrganizationData`, one **SQLite-backed Durable Object per organization** (`idFromName(organizationId)`, `locationHint: "sam"`), Drizzle over `ctx.storage` |
| Booking     | `OrganizationData.book`                            | both rules of migration 0013 checked and the row inserted in one `transactionSync`                                                                          |
| Reminder    | `OrganizationData.alarm`                           | a `reminder` row per appointment; the object's one alarm is set to the earliest due                                                                         |
| Screens     | `src/routes/ingresar.tsx`, `src/routes/agenda.tsx` | plain HTML forms posting to `/api/sign-in`, `/api/appointments`, `/api/rooms`                                                                               |
| Seed        | `src/routes/api/dev/seed.ts`, `scripts/seed.mjs`   | 1 organization, 1 admin, 4 practitioners, 2 rooms, 20 patients, 1,597 appointments (Oct–Dec 2026, 13 overbookings)                                          |

Every call into an organization's object passes the session's `{ userId, organizationId, roles }`,
taken from the session token `clerkMiddleware` verified. The object refuses a caller whose
organization is not its own (`ctx.id.name`), who has no roles, or whose roles do not allow the
action (`createRoom` is admin only). A removed member keeps access until the session token
expires (60 s by default).

> Sections below up to "Deployed run (2026-11-05)" record the first version, on Better Auth and
> D1; "Clerk (2026-11-06)" records this one.

### The booking rules (migration 0013)

- `appointment_practitioner_overlap`: no two active (`booked`, `confirmed`, `checkedIn`,
  `attended`) non-overbooking appointments of one practitioner overlap. An overbooking
  (`sobreturno`) is outside it on both sides.
- `appointment_room_overlap`: no two active appointments of different practitioners overlap in
  one room, overbookings included. A practitioner's own overbookings stay allowed.

Both are a `SELECT … LIMIT 1` on `(practitioner_id, starts_at)` / `(room_id, starts_at)`, bounded
by the longest duration (720 min, the `medicalService` limit), then the insert, all inside
`ctx.storage.transactionSync`. No `await` sits between check and insert, and a Durable Object
runs one event at a time, so there is no check-then-insert race.

## Checks (local, `pnpm dev` unless noted; 4-core AMD EPYC VM)

1. **Roles**: admin and `p1` sign in (303 → `/agenda`, 121 appointments shown for the week of
   2026-11-02); a wrong password goes back to `/ingresar?error=1`; signed out, `/agenda` redirects
   to `/ingresar`. `POST /api/rooms`: admin 201, practitioner 403 `{"reason":"forbidden"}`.
2. **Concurrency**, 50 parallel requests, pairwise-overlapping 60-minute spans:
   - one practitioner, rooms alternating: 1 saved, 49 refused by the practitioner rule.
   - one room, four practitioners: 1 saved, 38 refused by the room rule, 11 by the practitioner rule.
   - one room, four practitioners, all overbookings: 12 saved (all the winning practitioner's
     own overbookings, which rubens allows), 38 refused by the room rule.
     The week then holds 14 appointments, matching the responses.
3. **Agenda week page** (121 appointments, 4 practitioners), 20 requests:
   - dev server: Worker median 22 ms, max 49 ms; client median 37 ms.
   - production build (`vite build && vite preview`): Worker median 9 ms, max 11 ms; client median 15.5 ms.
   - per page: 1 Durable Object call, 421 SQLite rows read, 0 written, ~1 ms inside the object;
     2 D1 queries in the Worker for Better Auth's session; the object's membership check is
     1 D1 query when its 30 s cache is cold, else 0.
4. **Alarm**: an appointment booked with `remindInSeconds: 3` reads `remindedAt: null` right
   after, and `remindedAt` set ~3 s later; the agenda shows it `reminded`.
5. **Fresh clone** (/tmp, new empty dir, no `.env`, no `.dev.vars`): `pnpm install` 4 s (warm
   store), `pnpm dev` serving `/ingresar` after 5 s, `pnpm seed` 0.5 s (1,597 appointments); a
   practitioner signs in and sees the week's 121 appointments; checks 1, 2 and 4 repeat with the
   same results. The first request logs Better Auth's `Database schema mismatch` notice; its
   migrator then creates the tables and nothing else is needed.
6. **CPU** (inside the local workerd):
   - Better Auth password hash: median 42 ms; verify: median 42 ms. It already uses native
     `node:crypto` scrypt (`@better-auth/utils` picks it under the `workerd` condition),
     N=16384, r=16, 32 MiB.
   - WebCrypto PBKDF2-SHA256: 10 ms at 100k iterations, 60 ms at 600k.
   - Sign-in request: 55–66 ms; agenda render: 9 ms in a production build.
   - Locally `performance.now()` advances during CPU work (a 5·10⁷-step loop reads 32 ms), so
     these are wall times on this CPU, an approximation of CPU time. The free plan's limit is
     10 ms of CPU per request, measured by Cloudflare on its own hardware; only a deployed run
     settles it (the dashboard's CPU time per invocation, or `wrangler tail`).

## Deployed run (2026-11-05)

Deployed once to a free-plan account (`rubens-prototype.<subdomain>.workers.dev`), measured with `wrangler tail`, then the Worker and its D1 database were deleted. CPU time per invocation, as Cloudflare measured it:

| Request | n | CPU median | CPU max | Outcome |
| --- | --- | --- | --- | --- |
| `POST /api/sign-in` (scrypt verify) | 20 | 90 ms | 144 ms | 19 ok, 1 `exceededCpu` (503) |
| `GET /agenda`, Worker | 21 | 12 ms | 24 ms | all ok |
| `GET /agenda`, the organization's object | 21 | 2 ms | 8 ms | all ok |

The free plan's 10 ms is not a hard cut per request, but sign-in fails at random under it: rubens needs Workers Paid, or a sign-in with no password hash. The agenda's wall time in the Worker was about 535 ms (one object call and two D1 session queries, each a round trip from the South American edge to the US East); a round trip from Argentina was about 0.67 s. A session cookie cache or Smart Placement would cut the D1 trips.

Two fixes the deployed run needed: the seed answers a request with the `SEED_KEY` secret in `x-seed-key` outside dev, and the agenda server function reads the cookie from `getRequest().headers` (deployed, `getRequestHeaders()` carried no cookie, so every agenda load redirected to sign-in).

## Clerk (2026-11-06)

Better Auth's password check cost ~90 ms of CPU deployed, so auth moved to Clerk and D1 went
away. Checks, through Clerk's `<SignIn/>` in headless Chrome (Playwright) and its session token:

1. **Roles**: admin and `p1` sign in (token `roles: ["admin"]` / `["practitioner"]`, 121
   appointments for the week of 2026-11-02); `POST /api/rooms` admin 201, practitioner 403; no
   token: API 401, `/agenda` 307 → `/ingresar`. Deployed: the same 403 and 307.
2. **Concurrency** (50 requests, admin's token, local): one practitioner 1 saved / 49 refused;
   one room 1 saved / 37 room / 12 practitioner; all overbookings 13 saved / 37 room.
3. **Deployed CPU** (free plan, `wrangler tail`, all outcomes `ok`):

   | Request | n | Worker CPU | Object CPU |
   | --- | --- | --- | --- |
   | `GET /api/appointments/counts` (Clerk check + 1 object call, no render) | 11 | median 4 ms, max 5 | 2 ms |
   | `GET /agenda`, browser (cookie) | 16 | median 35.5 ms, max 57 | median 5 ms, max 19 |
   | `GET /agenda`, `Authorization: Bearer` | 10 | median 20.5 ms, max 68 | 3 ms |

   Clerk's check costs a few ms: the agenda's cost is rendering the week (12 ms median in the
   Better Auth run; higher here, not yet explained). Load time from Argentina: 461 ms median in
   the browser, 368 ms with curl (one object round trip to the US East; no D1).
4. **Dev with no secrets**: with no `.dev.vars`, `pnpm dev` and `pnpm seed` run with the dev
   sign-in, and checks 1 and 2 give the same counts.

What did not port cleanly:

- `src/start.ts` is bundled for the browser too, so it cannot import `cloudflare:workers`; it
  reads `process.env.CLERK_SECRET_KEY`, which `nodejs_compat` fills from the Worker's secrets.
- With `src/start.ts`, Start drops its default CSRF middleware; it is added back there.
- Clerk's keyless mode is not in `@clerk/tanstack-react-start` 1.7.9, hence the dev sign-in.
- Clerk rejects `.example` addresses; the seed uses `+clerk_test@example.com`.
- **Clerk's free plan caps an organization at 5 members** (Pro lifts it). A rubens member
  belongs to one organization, so Clerk Organizations were turned off: the organization id
  (rubens' own) and the roles live in the user's public metadata. Rerun deployed with that
  (2026-11-06): the same 121 appointments, 201/403, 307 signed out; `/api/appointments/counts`
  median 5 ms Worker CPU (n=5), `/agenda` median 26 ms, max 49 (n=13), object median 1.5 ms;
  browser load median 470 ms. Rubens now owns staff management (invite, remove, change roles)
  through Clerk's Backend API; a removed member keeps access until the token expires (60 s).

## Deploying

It takes:

```sh
pnpm dlx wrangler login                      # or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
pnpm deploy                                  # vite build && wrangler deploy
pnpm dlx wrangler secret put CLERK_SECRET_KEY
pnpm dlx wrangler secret put CLERK_PUBLISHABLE_KEY
```

- Bindings: `ORGANIZATION` (Durable Object `OrganizationData`, migration `v1` with
  `new_sqlite_classes`); secrets `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, optionally `SEED_KEY`.
- Clerk: Organizations off; Sessions → Customize session token:
  `{ "org": "{{user.public_metadata.organizationId}}", "roles": "{{user.public_metadata.roles}}" }`.
- An API token for CI: the "Edit Cloudflare Workers" template (Workers Scripts: Edit, Account Settings: Read, User Details: Read, Memberships: Read) plus Account › D1: Edit; Durable Objects deploy with Workers Scripts.
  Settings: Read, User › Memberships: Read (Workers Durable Objects come with Workers Scripts).
- The paid plan (Workers Paid, USD 5/month) lifts CPU to 30 s by default; the free plan's
  10 ms is what the password hash fails locally.

## Docs used

- TanStack Start hosting, Cloudflare Workers: https://tanstack.com/start/latest/docs/framework/react/guide/hosting
- Cloudflare, TanStack Start (custom entrypoint, Durable Object exports): https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
- Cloudflare Vite plugin: https://developers.cloudflare.com/workers/vite-plugin/
- Durable Objects SQLite storage API (`sql.exec`, `transactionSync`, cursor `rowsRead`): https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Durable Object alarms: https://developers.cloudflare.com/durable-objects/api/alarms/
- Durable Object location hints: https://developers.cloudflare.com/durable-objects/reference/data-location/
- D1 Worker binding API: https://developers.cloudflare.com/d1/worker-api/
- Workers limits (CPU time per plan): https://developers.cloudflare.com/workers/platform/limits/
- Drizzle on Durable Objects SQLite: https://orm.drizzle.team/docs/connect-cloudflare-do
- Better Auth, Cloudflare D1 / database options: https://www.better-auth.com/docs/concepts/database
- Better Auth organization plugin: https://www.better-auth.com/docs/plugins/organization
- Clerk TanStack React Start quickstart: https://clerk.com/docs/tanstack-react-start/getting-started/quickstart
- Clerk `clerkMiddleware()` for TanStack Start: https://clerk.com/docs/reference/tanstack-react-start/clerk-middleware
- Clerk session token customization: https://clerk.com/docs/backend-requests/resources/session-tokens
- Clerk organization membership limits: https://clerk.com/docs/organizations/overview
