# Review

What the shared `implement` skill's step 5 and the `code-review` skill need to know about underthing.
underthing holds health data (Ley 25.326, Ley 26.529), so the areas below are where a wrong change
hurts a patient or another organization's data.

## Full review

A diff that touches any of these goes to the full review, beside the migrations, `GLOSSARY.md`
terms and destructive scripts the shared skill always sends there:

- **Patient data and clinical records**: anything that stores, reads, shows or sends a patient's
  data or a clinical note (ADR-0003, ADR-0005).
- **Tenancy**: the step that picks the organization's object from the verified session, the
  object's authorization from its member table, its storage and schema (ADR-0008).
- **Auth**: the session token check and the dev sign-in, Clerk's accounts, the setup and seed
  endpoints behind their secrets, and who may call a server function (ADR-0009).
- **The Worker's deploy config**: `wrangler.jsonc`, its bindings and object migrations, which
  apply at every deploy.

The paths, for `review.py`:

```review-paths
full patient data: (^|/)(clinical|patients?|pacientes?|historias?|evolucion(es)?)[^/]*(/|\.)
full tenancy: ^src/server/(caller|with-organization)\.ts$
full tenancy: ^src/organization/(organization|members|database|schema)\.ts$
full auth: ^src/organization/accounts\.ts$
full auth: ^src/server/(sign-in\.functions|organization-setup)\.ts$
full auth: ^src/routes/api/
full migration: ^src/organization/migrations/
full migration: ^drizzle\.organization\.config\.ts$
full deploy config: ^wrangler\.jsonc$
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
- tenancy: which organization's object a call reaches, and the object's authorization;
- auth.

## Hotspots

Where this codebase gets hurt, for the correctness brief:

two appointments that overlap without being an overbooking, or one outside its schedule or inside a closure;
an instant stored or shown in the wrong time zone, or a local time stored without its office's
zone; an organization id taken from the request instead of the verified session, or an object
reached by another organization's name; an object method that skips `#as()` or states a weaker
requirement than the server function it replaced; an `await` between a check and the write it
guards inside the object, which lets another event in; a server function reachable by a user who
should be refused (a receptionist reading a clinical note, a deactivated member, one who must
still change their password); a clinical note edited without keeping its earlier version, or a note version updated or deleted other than clearing a voided note's text; patient data (names, phone
numbers, appointment times, clinical text) that reaches a log, an error message, an alert or a
Worker log line.

**Who acts concurrently**, for weighing a race (the `implement` skill, step 2). underthing is not
deployed, so these actors are expected, not measured. Inside one `organization`: `receptionist`s at
a front desk booking, rescheduling and cancelling into the same rooms and hours; `practitioner`s and
`admin`s editing the `schedule`s, `timeOff` and `closure`s those `appointment`s sit in; and, once
they exist, the object's alarms (a `reminder`) acting on the same appointments. A `patient` does not sign in, and organizations
share no rows, so organizations never race each other. Two receptionists taking the same free slot
is the everyday race, and the object turns it into a refusal the second one sees: it runs one
event at a time and checks and writes a booking in one synchronous transaction
([ADR-0008](../adr/0008-cloudflare-workers-one-object-per-organization.md), ADR-0003). The expected peaks are the start of the clinic day and an agenda opening. Once deployed,
measure appointments created per minute per `office`.

## Breadth

- **Entry points.** A behaviour reachable from the admin is usually reachable from the portal
  too, or from a list and its detail. Name the paths you checked and the ones deliberately
  different.
- **Tenancy.** Every server function reaches data through `withOrganization()`, the organization
  comes from the verified session and never from the request body, and every object method
  authorizes through `#as()` with its requirement
  ([ADR-0008](../adr/0008-cloudflare-workers-one-object-per-organization.md)).
- **Interface.** A new component, variant or token is checked against what `src/components/`
  already has: lint catches a restyle or an off-theme class, not a second component doing the
  job of an existing one ([style-guide.md](./style-guide.md)).
- **Docs.** The documentation rules are [workflows.md](./workflows.md#documentation).

## One-way doors

Always one-way on underthing, beside the shared list:

- A reminder or message sent to a patient.
- Any change to how clinical notes are written, read or retained.
- Any change that widens who can read patient data: the RLS policies and the grants behind them.
- Production infrastructure, as [infrastructure.md](../operations/infrastructure.md) describes it.
