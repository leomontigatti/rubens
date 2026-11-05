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

Sign in at `/ingresar` as `admin@rubens.example` or `p1@rubens.example` … `p4@rubens.example`,
password `rubens-dev-password`. The agenda is `/agenda?week=2026-11-02`.

Other scripts, against the running dev server:

- `node scripts/concurrency.mjs practitioner|room|room-overbooking [n]`: n concurrent bookings, counted.
- `GET /api/dev/bench?n=10`: Better Auth password hash and verify timed inside workerd.
- Every response carries `Server-Timing`: Worker wall time, Durable Object calls, SQLite rows
  read and written, and D1 queries.

`/api/dev/*` answers 404 in a production build.

## Shape

| Piece       | Where                                              | What                                                                                                                                                        |
| ----------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker      | `src/server.ts`                                    | TanStack Start's handler, wrapped for `Server-Timing`; exports the Durable Object class                                                                     |
| Auth        | `src/lib/auth.ts`                                  | Better Auth, email and password, organization plugin; users, sessions, organizations and members in **D1** (`DB`)                                           |
| Clinic data | `src/org/organization-data.ts`                     | `OrganizationData`, one **SQLite-backed Durable Object per organization** (`idFromName(organizationId)`, `locationHint: "sam"`), Drizzle over `ctx.storage` |
| Booking     | `OrganizationData.book`                            | both rules of migration 0013 checked and the row inserted in one `transactionSync`                                                                          |
| Reminder    | `OrganizationData.alarm`                           | a `reminder` row per appointment; the object's one alarm is set to the earliest due                                                                         |
| Screens     | `src/routes/ingresar.tsx`, `src/routes/agenda.tsx` | plain HTML forms posting to `/api/sign-in`, `/api/appointments`, `/api/rooms`                                                                               |
| Seed        | `src/routes/api/dev/seed.ts`, `scripts/seed.mjs`   | 1 organization, 1 admin, 4 practitioners, 2 rooms, 20 patients, 1,597 appointments (Oct–Dec 2026, 13 overbookings)                                          |

Every call into an organization's object passes the session's `{ userId, organizationId }`.
The object refuses a caller whose organization is not its own (`ctx.id.name`), who has no
`member` row in D1, or whose roles do not allow the action (`createRoom` is admin only). The
membership is cached in the object for 30 s, so a removed member keeps access for up to 30 s.

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

## Deploying (not done)

Nothing was deployed and no account or token was created. It would take:

```sh
pnpm dlx wrangler login                      # or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
pnpm dlx wrangler d1 create rubens-auth      # paste the database_id into wrangler.jsonc
pnpm dlx wrangler secret put BETTER_AUTH_SECRET
pnpm deploy                                  # vite build && wrangler deploy
```

- Bindings: `DB` (D1 `rubens-auth`), `ORGANIZATION` (Durable Object `OrganizationData`, migration
  `v1` with `new_sqlite_classes`), secret `BETTER_AUTH_SECRET`, optionally var `BETTER_AUTH_URL`.
- An API token for CI: the "Edit Cloudflare Workers" template (Workers Scripts: Edit, Account Settings: Read, User Details: Read, Memberships: Read) plus Account › D1: Edit; Durable Objects deploy with Workers Scripts.
  Settings: Read, User › Memberships: Read (Workers Durable Objects come with Workers Scripts).
- The paid plan (Workers Paid, USD 5/month) lifts CPU to 30 s by default; the free plan's
  10 ms is what the password hash fails locally.
- Better Auth's tables are created on first use by its migrator (`getMigrations`); a real port
  would generate SQL with `@better-auth/cli generate` and apply it with `wrangler d1 migrations apply`.

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
