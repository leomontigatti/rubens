# ADR-0001: Application stack

**Status**: accepted

Date: 2026-10-12. Amended 2026-10-27:

- The shadcn/ui components are built on Base UI (the `base-nova` style), not Radix.

Amended 2026-11-02 (#91): `rrule` is dropped. It came with the bootstrap and nothing
ever imported it: schedules are weekdays with times and validity dates, expanded with
`date-fns` ([ADR-0003](./0003-scheduling-and-clinical-records.md)).

Amended 2026-11-06 (#125): when the port lands, the app runs on Cloudflare Workers, with
each organization's data in a SQLite Durable Object
([ADR-0008](./0008-cloudflare-workers-one-object-per-organization.md)), and staff sign in
through Clerk ([ADR-0009](./0009-staff-sign-in-through-clerk.md)). Nitro, Postgres,
pg-boss and Better Auth go, and with them the reasons below for Drizzle's RLS support,
for pg-boss and for Better Auth over Clerk. Until then, the table describes the code.

Amended 2026-11-02: TanStack Virtual is dropped. Nothing imported it, and no list needs it: the
patient registry is paged and the calendar is a fixed grid. A list that grows past paging adds it back.

Rubens is a booking app for a health care business: receptionists and
professionals, several offices, rooms that are shared or exclusive, and — for the
professionals whose practice needs it — a clinical history per patient. The stack
was chosen for that shape, not inherited wholesale from En Escena.

| Concern         | Choice                                               |
| --------------- | ---------------------------------------------------- |
| Framework       | TanStack Start (React 19), served by Nitro on Node   |
| Toolchain       | Vite+ (`vp`): Vite, Vitest, Oxlint, Oxfmt, Rolldown  |
| Database        | Postgres 17                                          |
| ORM             | Drizzle, with raw SQL migrations where Drizzle stops |
| Auth            | Better Auth with the organization plugin             |
| Client data     | TanStack Query; TanStack Form and Table for UI       |
| Validation      | Zod 4                                                |
| Background jobs | pg-boss, in the same Postgres                        |
| Dates           | `date-fns` 4 and `@date-fns/tz`                      |
| UI              | shadcn/ui on Base UI and Tailwind 4                  |

## Why each, where it was a real trade-off

- **TanStack Start over React Router and Next.js.** The calendar keeps its state
  in the URL (date, office, professional, view), and TanStack Router validates and
  types search params end to end. The app is behind login, so Next.js's strengths
  (RSC, static rendering, edge) buy nothing, and its build is not Vite. React
  Router was the safer, more mature option; TanStack Start was taken knowing it
  churns faster.
- **Vite+ from day one.** It is one CLI over tools En Escena already ran
  separately. 1.0 shipped on 2026-09-28, so it is young; the escape hatch is cheap
  because every piece underneath is the plain upstream tool.
- **Drizzle over Prisma.** The hard parts of this schema are Postgres features:
  exclusion constraints, row-level security, triggers. Drizzle sits closest to SQL
  and declares RLS policies natively. TanStack has no ORM; TanStack DB is a
  client-side store and is deliberately not adopted yet (pre-1.0).
- **Better Auth over Clerk.** Self-hosted, no per-user pricing, and no patient
  data in a third-party identity vendor.
- **pg-boss over Trigger.dev or Inngest.** Job payloads carry patient names,
  phone numbers and appointment times. A queue inside our own Postgres keeps that
  data in our infrastructure (Ley 25.326), needs no extra service, and lets a
  booking and its reminder be enqueued in one transaction.
- **TanStack Form over React Hook Form.** Fits Start's server functions; one Zod
  schema validates on both sides.
- **Base UI under shadcn/ui, not Radix.** shadcn 4's CLI defaults to Base UI
  (`base-nova`); the bootstrap had taken the pre-4.0 Radix style `new-york` without
  a decision. Moving with seven components in the tree was cheap; later it would
  mean rewriting every `asChild` call site.
- **Nitro 3 is a beta** and is pinned to an exact version for that reason.
