# ADR-0009: Staff sign in through Clerk, without Clerk Organizations

**Status**: accepted; replaces Better Auth when the port of
[ADR-0008](./0008-cloudflare-workers-one-object-per-organization.md) lands.

Date: 2026-11-06. Decided in #125.

On Workers, Better Auth's password check cost a median 90 ms of CPU deployed, even
with native scrypt, against the free plan's 10 ms, and 1 sign-in in 20 failed with
`exceededCpu`. With Clerk, the password check runs on Clerk's servers. The Worker
only verifies Clerk's session token: a call that verifies it and reaches the
organization's object took a median 5 ms of CPU deployed.

## Organization and roles live on the user

Clerk's free plan caps an organization at 5 members. A member of Rubens belongs to
exactly one organization ([ADR-0002](./0002-tenancy-and-database-connections.md)), so
Clerk Organizations are off. Each Clerk user carries, in its public metadata, the
organization id Rubens issued and the member's roles (`admin`, `receptionist`,
`practitioner`, any combination). The session token carries both as claims (`org`,
`roles`), and the Worker passes them to the organization's object.

## Consequences

- Rubens owns staff management: inviting, removing and changing roles are Rubens'
  screens, calling Clerk's Backend API. Clerk's organization screens are not used.
- A removed member keeps access until the session token expires, about a minute.
- Staff identities (names, emails, passwords) are held by Clerk, in the United States.
  Patients have no accounts, so no patient data is in Clerk.
- Dev runs with no Clerk key, through a dev sign-in that picks a seeded member.
  Clerk's no-key mode does not exist for TanStack Start yet.

## Considered options

- **Better Auth on Workers Paid (US$5/month)**: self-hosted and no vendor, at the cost
  of the plan and the ~90 ms password check on every sign-in.
- **Better Auth with a passwordless sign-in** (email codes, passkeys): no hash to
  compute, but email delivery to build and run.
- **WorkOS AuthKit**: a higher free tier; not prototyped.
- **Clerk Organizations**: Clerk's own organization screens and invitations, but 5
  members per organization on the free plan, and Pro (about US$25/month) beyond it.
