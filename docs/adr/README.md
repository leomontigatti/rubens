# Architecture Decisions

Read ADRs selectively: start with the topic that matches the change. Format and
when to write one: the shared `domain-modeling` skill's `ADR-FORMAT.md`.

`docs/adr/*.md` is live decisions only. A superseded ADR moves to
`docs/adr/superseded/`, kept for its rationale.

## By topic

- Stack and tooling: `0001-stack.md`
- Tenancy, RLS, database roles and connections: `0002-tenancy-and-database-connections.md`
- Database schema and naming: `0004-dedicated-postgres-schema.md`
- Scheduling: `0003-scheduling-and-clinical-records.md`
- Clinical records: `0005-versioned-clinical-notes.md`, with the access and audit
  rules in `0003-scheduling-and-clinical-records.md`
- Hosting on Cloudflare Workers, the organization's Durable Object, jobs, encryption:
  `0008-cloudflare-workers-one-object-per-organization.md`
- Staff sign-in: `0009-staff-sign-in-through-clerk.md`
- WhatsApp, the assistant and Telegram: `0010-whatsapp-cloud-api-number-per-organization.md`
  (the channel), `0006-patient-assistant-on-whatsapp.md` (the model and proposals),
  `0007-patients-words-on-telegram.md`

## Decisions

- [ADR-0001: Application stack](./0001-stack.md) - TanStack Start on Vite+,
  Drizzle on Postgres, Better Auth, pg-boss, shadcn/ui on Base UI; why each over its alternative.
- [ADR-0002: Tenancy, row-level security and database connections](./0002-tenancy-and-database-connections.md) -
  one organization per professional, RLS as the boundary, and the rules that keep
  a connection pooler a config change (`withTenant`, two URLs, no session state).
- [ADR-0003: Scheduling integrity and clinical records](./0003-scheduling-and-clinical-records.md) -
  exclusion constraints and schedules against double booking; audited clinical
  records readable by every practitioner who keeps them.
- [ADR-0004: App tables live in a dedicated `rubens` schema, unprefixed](./0004-dedicated-postgres-schema.md) -
  learned from en-escena#506: no `public`, no name prefix, qualified raw SQL.
- [ADR-0005: Clinical notes are versioned, files live on the server's disk](./0005-versioned-clinical-notes.md) -
  notes edited with every version kept instead of signed and amended; no app-level
  encryption at launch; attachments on a Coolify volume, streamed by the app.
- [ADR-0006: Patients talk to an assistant on the organization's WhatsApp number](./0006-patient-assistant-on-whatsapp.md) -
  the model interprets and Rubens decides through proposals; TanStack AI. Its channel
  (WAHA on the organization's own number) and pg-boss worker are superseded by ADR-0010.
- [ADR-0007: A handoff carries the patient's own words to Telegram](./0007-patients-words-on-telegram.md) -
  people can answer handed-off patients from Telegram; amended by ADR-0010, which makes
  the app's view a full inbox.
- [ADR-0008: Rubens runs on Cloudflare Workers, one Durable Object per organization](./0008-cloudflare-workers-one-object-per-organization.md) -
  the free plan, each organization's data in its own SQLite object as the tenant
  boundary, booking rules and jobs in the object, app-level encryption of clinical
  data; supersedes ADR-0002 and ADR-0004 when the port lands.
- [ADR-0009: Staff sign in through Clerk, without Clerk Organizations](./0009-staff-sign-in-through-clerk.md) -
  Better Auth's password check exceeds the free plan's CPU; organization and roles on
  the Clerk user, since Clerk's free plan caps an organization at 5 members.
- [ADR-0010: Each organization gets a new number on Meta's WhatsApp Cloud API](./0010-whatsapp-cloud-api-number-per-organization.md) -
  owned and paid for by the practice, onboarded through Embedded Signup with Rubens as
  Tech Provider; approved templates without buttons and the 24-hour window; the webhook
  stores into the organization's object, whose alarm runs the assistant; a full inbox in
  the app.
