# ADR-0008: Rubens runs on Cloudflare Workers, one Durable Object per organization

**Status**: accepted; the port landed in #131. It supersedes
[ADR-0002](./superseded/0002-tenancy-and-database-connections.md) and
[ADR-0004](./superseded/0004-dedicated-postgres-schema.md).

Date: 2026-11-06. Decided in #125, from the prototype on the `prototype/cloudflare-workers`
branch, whose README has the measurements.

Amended 2026-11-06: where the WhatsApp gateway runs, left open here, is settled by
[ADR-0010](./0010-whatsapp-cloud-api-number-per-organization.md); see Consequences.

Rubens moves from one VPS (Node, Postgres, Coolify) to Cloudflare Workers on the free
plan. An organization's data (offices, rooms, practitioners, schedules, patients,
appointments, clinical records, the audit log) lives in one Durable Object of its own,
with SQLite storage. Staff sign in through Clerk ([ADR-0009](./0009-staff-sign-in-through-clerk.md)).
The point is to run no servers for the app, at no cost while the number of
organizations is small. Counsel confirmed on 2026-11-05 that the data may be stored in
the United States.

## The organization's object is the tenant boundary

The Worker takes the organization and the roles from the verified session token and
calls that organization's object, and only it. No query can reach another
organization's data, because no other organization's data is in that object. The
object checks the roles on every call. Row-level security, `withTenant()`, the two
database URLs and the `rubens_app` role of ADR-0002 have nothing left to guard.

## Rules the database enforced move into the object

SQLite has no exclusion constraints, `tstzrange`, row-level security or grants.

- **Double booking**: the object checks both overlap rules of
  [ADR-0003](./0003-scheduling-and-clinical-records.md) and inserts the appointment in
  one synchronous storage transaction, with no `await` in between. An object runs one
  event at a time, so there is no check-then-insert race: 50 concurrent bookings for
  one practitioner saved exactly one in the prototype.
- **Receptionists cannot read clinical notes**, **the audit log is append-only**, and
  **a version is never updated**: these become checks in the object's code. Every
  write goes through the object's methods, so they are the one place to test them.
- Instants are integers (Unix milliseconds, UTC); a span is `[start, end)`, and each
  office still has its IANA time zone.

## Jobs are Durable Object alarms

Reminders, confirmations and no-show marking become rows in the object, with the
object's one alarm set to the earliest due. A booking and its reminder are written in
one transaction, as pg-boss allowed. pg-boss goes.

## Clinical text and files are encrypted by the app

Clinical notes, their versions and attached files are encrypted by the app before
they are stored, with a key per organization held in Worker secrets. This reverses the
"no application-level encryption" section of
[ADR-0005](./0005-versioned-clinical-notes.md): the data now sits on a provider's disks
abroad, not on a VPS of our own. Cloudflare's encryption at rest stays underneath.
Names, document numbers and other fields that are searched stay in clear, so the
registry can search them.

Files move from the VPS's disk to R2, encrypted the same way, still streamed by the
app after the access check.

## Considered options

- **Stay on the VPS** (ADR-0001's stack): no port, but a server to run and patch, and
  Coolify to manage it.
- **D1 for all the data**, with `organization_id` on every row: one database, closer to
  today's shape, but the tenant boundary back in every query, and no South American
  location either.
- **Workers Paid (US$5/month)** to lift the 10 ms CPU limit: kept as the fallback if the
  agenda cannot be brought under it.

## Consequences

- **The free plan's 10 ms CPU per request is a design constraint.** The agenda week page
  took a median 26 ms deployed in the prototype; bringing it under is part of the port,
  before a real organization uses it.
- **Data lives in the US East**: objects hinted to South America are created there
  today. A page from Argentina took about 470 ms.
- The 17 Postgres migrations, the schema module and the DB test suite are rewritten for
  SQLite in the object. Tests that proved a constraint or a policy become tests of the
  object's methods.
- WhatsApp needs no gateway of its own: Meta's Cloud API calls the Worker's webhook, and
  the organization's object runs the assistant from its alarm
  ([ADR-0010](./0010-whatsapp-cloud-api-number-per-organization.md)).
- Dev needs no keys and no account: Miniflare runs the Worker and the objects locally,
  and with no Clerk key the app uses a dev sign-in.
