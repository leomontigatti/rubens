# ADR-0002: Tenancy, row-level security and database connections

**Status**: accepted

Date: 2026-10-12

## Tenancy

Every business is an `organization`. A professional belongs to exactly one
organization: there is no cross-organization calendar and no exception to the
tenant boundary for professionals. Every tenant-owned table carries
`organization_id`, and Postgres row-level security enforces it — the UI and the
server functions are not the boundary.

## Rules that keep a connection pooler possible

There is no pooler today: one app instance on one VPS, with a pool of ~10
connections in the driver, is enough. A pooler (PgBouncer in transaction mode)
must stay a configuration change, never a refactor. Its transaction mode hands a
server connection to a different client after every transaction, so these rules
hold from the first line of code:

1. **The tenant is set per transaction, never per session.** Use
   `withTenant()` (`src/db/tenant.ts`), which runs
   `set_config('app.organization_id', $1, true)` — the `true` makes it
   transaction-local, the same as `SET LOCAL`. A plain `SET` would survive on the
   pooled connection and the next request, possibly another organization's, would
   run under it: a cross-tenant data leak.
2. **Two URLs.** `DATABASE_URL` is what request handlers use and is the one a
   pooler would front. `DATABASE_DIRECT_URL` always reaches Postgres directly and
   is used by migrations and by pg-boss, which needs session features
   (`LISTEN/NOTIFY`, advisory locks) that transaction pooling breaks. Today both
   point at the same server.
3. **No session state in request code**: no session-level `SET`, no
   `LISTEN`, no session advisory locks, no long-lived named prepared statements.

## Roles

RLS does not apply to a table's owner. Migrations run as the owner role
(`DATABASE_DIRECT_URL`); the app connects as `rubens_app`, which owns nothing and
has no `BYPASSRLS`. A test of an RLS policy must run as `rubens_app`, or it
proves nothing.
