# Review

What the shared `implement` skill's step 5 and the `code-review` skill need to know about Rubens.
Rubens holds health data (Ley 25.326, Ley 26.529), so the areas below are where a wrong change
hurts a patient or another organization's data.

## Full review

A diff that touches any of these goes to the full review, beside the migrations, `GLOSSARY.md`
terms and destructive scripts the shared skill always sends there:

- **Patient data and clinical records**: anything that stores, reads, shows or sends a patient's
  data or a clinical note (ADR-0003).
- **Tenancy and row-level security**: the schema, `withTenant()`, the `db` client, the roles and
  grants, and the RLS policies (ADR-0002).
- **Auth**: Better Auth's config and handler, sessions, and who may call a server function.
- **The production container's start**: the entrypoint and migration runner, which run at
  every deploy.

The paths, for `review.py`:

```review-paths
full patient data: (^|/)(clinical|patients?|pacientes?|historias?|evolucion(es)?)[^/]*(/|\.)
full tenancy: ^src/db/(tenant|client)\.ts$
full tenancy: ^src/db/schema/
full tenancy: ^docker/postgres/
full auth: ^src/lib/auth(-client)?\.ts$
full auth: ^src/routes/api/auth/
full migration: ^src/db/migrations/
full migration: ^scripts/(migrate\.mjs|migrations/)
full migration: ^drizzle\.config\.ts$
full production start: ^(Dockerfile|scripts/docker-entrypoint\.sh)$
full destructive script: ^scripts/worktree-db\.ts$
full glossary: ^GLOSSARY\.md$
quiet: ^\.fallowrc\.json$
quiet: ^\.vite-hooks/
quiet: ^\.github/(dependabot\.yml|pull_request_template\.md)$
quiet: ^t3\.json$
quiet: ^components\.json$
quiet: ^assets/
quiet: ^\.env\.example$
```

## Always ask

A finding in one of these areas is the user's call unless the issue already settles it:

- patient data or clinical records;
- tenancy or row-level security;
- auth.

## Hotspots

Where this codebase gets hurt, for the correctness brief:

two appointments that overlap without being an overbooking, or one outside its schedule or office hours;
an instant stored or shown in the wrong time zone, or a bare `timestamp` where `timestamptz`
belongs; a query on a tenant table outside `withTenant()`, or a path that leaves a session
setting behind for the next request (a session-level `SET`, `LISTEN`, a session advisory lock, a
long-lived named prepared statement); request code running as the owner role
(`DATABASE_DIRECT_URL`), which RLS does not apply to; a server function reachable by a user who
should be refused (a receptionist reading a clinical note, a request naming another
organization's id); a clinical note edited or deleted in place; patient data (names, phone
numbers, appointment times, clinical text) that reaches a log, an error message, an alert or a
job's log line or payload outside our own Postgres.

## Breadth

- **Entry points.** A behaviour reachable from the admin is usually reachable from the portal
  too, or from a list and its detail. Name the paths you checked and the ones deliberately
  different.
- **Tenancy.** Every query on a tenant-owned table runs inside `withTenant()`, the organization
  id comes from the session and never from the request body, and no request path sets session
  state ([ADR-0002](../adr/0002-tenancy-and-database-connections.md)).
- **Docs.** The documentation rules are [workflows.md](./workflows.md#documentation).

## One-way doors

Always one-way on Rubens, beside the shared list:

- A reminder or message sent to a patient.
- Any change to how clinical notes are written, read or retained.
- Any change that widens who can read patient data: the RLS policies and the grants behind them.
- Production infrastructure, as [infrastructure.md](../operations/infrastructure.md) describes it.
