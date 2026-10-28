# Production infrastructure

What production needs, and what is decided. Nothing is provisioned yet: items marked
**TBD** have no value and must not be guessed at. Items marked **OPEN** are decisions
that must be taken before patient data goes in.

## Status

Not deployed. Before the first deploy, these are still TBD:

- VPS provider, plan and server location (see the OPEN item on location below).
- Domain and Cloudflare zone, and the DNS record for the app.
- Coolify instance: where it runs, and the project and environment names.
- Backup provider, encryption tool and key custody, schedule and retention.
- Alerting channel and who receives it.

## Shape

The same model as En Escena (its `docs/operations/infrastructure.md`, in the sibling repository): a VPS running Coolify, behind Cloudflare, with the app built
from the `Dockerfile` and run as a container, and Postgres 17 run by Coolify as a
managed database in the same network. Deploys are manual: a person triggers the build
from Coolify, and it builds whatever `main` points to at that moment.

The hosts underneath (access, firewalls, Tailscale, a new device's first login) are
described in the private [`leomontigatti/infra`](https://github.com/leomontigatti/infra)
repository, checked out at `~/.t3/projects/infra`, not here: read its `README.md` and
`AGENTS.md` before touching a server, and add the host's page there when one is
provisioned. Commands that reach a host name its user (`ssh root@<host>`), so they work
from any admin device on the tailnet with no `~/.ssh/config` entry.

The app container is one process: `node .output/server/index.mjs` on port 3000, with
migrations applied first by the entrypoint (below).

## Before the first deploy

In this order:

1. **Create the app role with LOGIN.** `rubens_app` is the role RLS applies to, and
   the app connects as it. Migration `0001_app_role.sql` creates it as NOLOGIN only
   if it is missing, so create it yourself first:

   ```sql
   CREATE ROLE rubens_app LOGIN PASSWORD '<generated, stored in Coolify only>'
     NOSUPERUSER NOBYPASSRLS;
   ```

   If a migration already created it NOLOGIN, the same attributes go on an `ALTER ROLE
   rubens_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;`. Verify it with
   `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'rubens_app';`
   Expect `rolcanlogin = t`, `rolsuper = f`, `rolbypassrls = f`.
   Grants and default privileges are in the migrations; the role needs nothing else.

2. **Set the environment in Coolify** (below), with a fresh `BETTER_AUTH_SECRET` per
   environment.
3. **Configure backups, and restore one** to a scratch database (below). Do not admit
   patient data before this has happened once.
4. **Decide the location** (OPEN, below).

## Database roles and URLs

Two URLs, one database. The rule and its reasons are
[ADR-0002](../adr/0002-tenancy-and-database-connections.md); the summary:

| Variable              | Role                                                 | Used by                                                                                         |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | `rubens_app`                                         | request handlers. RLS applies. A pooler would front this one.                                   |
| `DATABASE_DIRECT_URL` | owner (`postgres` or the owner role Coolify creates) | migrations (`scripts/migrate.mjs`) and pg-boss. Always direct. RLS does not apply to the owner. |

Today both point at the same server, with no pooler. Connection pool size is 10 in
`src/db/client.ts`, which one app instance can carry.

Coolify holds both values. Neither goes in the repository (`.gitignore` ignores `.env`;
`.gitleaks.toml` catches a password in a URL in a committed file).

## Migrations run at container start

`scripts/docker-entrypoint.sh` runs `scripts/migrate.mjs` before the command. The script:

- connects with `DATABASE_DIRECT_URL` (falls back to `DATABASE_URL`), retrying only
  while the database is unreachable;
- takes an advisory lock, so two overlapping starts cannot apply the same migration twice;
- checks the journal against `drizzle.__drizzle_migrations` and refuses to continue if
  an applied migration's file changed;
- applies the pending migrations, with a 5-second lock timeout on DDL.

A failed migration exits non-zero, so the container does not start. The entrypoint is an
`ENTRYPOINT`, not a chained `CMD`, so a start command set in Coolify does not skip it.

Coolify keeping the previous container serving while the new one migrates is the
intended behaviour, and it is what makes a destructive migration dangerous. That is
why `check:migrations` flags drops and renames. Confirm it on the first real deploy
(TBD).

## Healthcheck

There is no health route yet. The image's `HEALTHCHECK` probes `/`, which answers 200
without a session. That proves the server is up, not that the database is reachable.
Add a route that checks the database when one exists, and point Coolify's healthcheck
at it (TBD: Coolify healthcheck path and timings).

## Backups

**Requirement, not yet set up**: encrypted off-site backups of the Postgres database and of
the attachments volume (ADR-0005: clinical files live on the VPS's disk), and
a restore that has been run, not just configured. A backup nobody has restored is a
hope, not a backup.

- Encryption: at rest on the backup target and with a key held outside the VPS (TBD: tool and key custody).
- Off-site: a location other than the VPS (TBD: provider, R2 the candidate, and whether it is in the same
  jurisdiction as the data; see OPEN below).
- Schedule and retention: TBD. Clinical records are kept at least ten years (ADR-0003),
  so retention is a legal question, not only an operational one.
- Restore drill: restore the latest backup into a scratch database, check that the
  migration journal and a known row are there, then drop it. Record
  the date. TBD: cadence.

## Connection pooling

None today. One app instance with a pool of 10 is enough, and nothing in the code
depends on a pooler being absent. Add PgBouncer in transaction mode when one of these is
true: more than one app instance, or connections from the app approach the Postgres
limit. Adding it is a configuration change only if the rules in ADR-0002 hold: tenant
set per transaction, two URLs, no session state in request code.

## Location (OPEN)

Health data is sensitive data under Ley 25.326 (ADR-0003). Where the server and the
backups sit is part of that: **the hosting country is a decision to make with local
counsel before go-live**, together with the AAIP registration and patient consent. Until
it is made, do not put real patient data on any server. Record the decision here, with
the date and the reason.

## Logs, errors and alerts

No patient data in logs, error messages, alerts or job payloads sent outside our own
Postgres (ADR-0001 explains why the job queue stays in Postgres). That covers names,
phone numbers, appointment times, notes and anything else identifying. Concretely:

- do not log request or response bodies on the server path;
- thrown error messages name the failure, never the record;
- Coolify log retention and access are TBD; treat application logs as containing no patient data by construction, not by filtering.

## Secrets

Environment variables live in Coolify, one set per environment. Never in the
repository, never in an image layer. Rotating `BETTER_AUTH_SECRET` signs everyone out;
rotating a database password means updating both the role and the URL in Coolify.

## Deploy

1. Push to `main` is not a deploy. Coolify builds only when a person triggers it.
2. Coolify builds the `Dockerfile` (build pack: Dockerfile).
3. The container runs the entrypoint (migrations), then the server on port 3000.
4. Check the new container's logs for `[migrate] migrations up to date.` and the healthcheck.

Rollback: redeploy the previous image. Migrations are not reversed automatically, so
a rollback is only safe if the migration was additive (see `check:migrations`).
