# Architecture Decisions

Read ADRs selectively: start with the topic that matches the change. Format and
when to write one: the shared `domain-modeling` skill's `ADR-FORMAT.md`.

`docs/adr/*.md` is live decisions only. A superseded ADR moves to
`docs/adr/superseded/`, kept for its rationale.

## By topic

- Stack and tooling: `0001-stack.md`
- Tenancy, RLS, database roles and connections: `0002-tenancy-and-database-connections.md`
- Database schema and naming: `0004-dedicated-postgres-schema.md`
- Scheduling and clinical records: `0003-scheduling-and-clinical-records.md`

## Decisions

- [ADR-0001: Application stack](./0001-stack.md) - TanStack Start on Vite+,
  Drizzle on Postgres, Better Auth, pg-boss; why each over its alternative.
- [ADR-0002: Tenancy, row-level security and database connections](./0002-tenancy-and-database-connections.md) -
  one organization per professional, RLS as the boundary, and the rules that keep
  a connection pooler a config change (`withTenant`, two URLs, no session state).
- [ADR-0003: Scheduling integrity and clinical records](./0003-scheduling-and-clinical-records.md) -
  exclusion constraints and schedules against double booking; append-only,
  audited clinical notes readable by every practitioner who keeps them.
- [ADR-0004: App tables live in a dedicated `rubens` schema, unprefixed](./0004-dedicated-postgres-schema.md) -
  learned from en-escena#506: no `public`, no name prefix, qualified raw SQL.
