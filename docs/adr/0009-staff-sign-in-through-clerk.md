# ADR-0009: Staff sign in through Clerk, without Clerk Organizations

**Status**: accepted; replaced Better Auth when the port of
[ADR-0008](./0008-cloudflare-workers-one-object-per-organization.md) landed (#131).

Date: 2026-11-06. Decided in #125.

Amended 2026-11-07: Rubens moved to Workers Paid
([ADR-0008](./0008-cloudflare-workers-one-object-per-organization.md#amended-2026-11-07-workers-paid)),
which removes the reason below. Staff sign-in stays on Clerk; see
[Keeping Clerk](#amended-2026-11-07-keeping-clerk-on-workers-paid).

On Workers, Better Auth's password check cost a median 90 ms of CPU deployed, even
with native scrypt, against the free plan's 10 ms (no longer the limit since the
2026-11-07 amendment), and 1 sign-in in 20 failed with
`exceededCpu`. With Clerk, the password check runs on Clerk's servers. The Worker
only verifies Clerk's session token: a call that verifies it and reaches the
organization's object took a median 5 ms of CPU deployed.

## Organization and roles live on the user

Clerk's free plan caps an organization at 5 members. A member of Rubens belongs to
exactly one organization ([ADR-0002](./superseded/0002-tenancy-and-database-connections.md)), so
Clerk Organizations are off. Each Clerk user carries, in its public metadata, the
organization id Rubens issued and the member's roles (`admin`, `receptionist`,
`practitioner`, any combination). The session token carries both as claims (`org`,
`roles`), and the Worker passes them to the organization's object.

## Consequences

- Rubens owns staff management: inviting, removing and changing roles are Rubens'
  screens, calling Clerk's Backend API. Clerk's organization screens are not used.
- A removed member loses access on their next call: the token still verifies until it
  expires, about a minute, but the organization's object authorizes every call from its
  own member table, which no longer lists them as active.
- Staff identities (names, emails, passwords) are held by Clerk, in the United States.
  Patients have no accounts, so no patient data is in Clerk.
- Dev runs with no Clerk key, through a dev sign-in that picks a seeded member.
  Clerk's no-key mode does not exist for TanStack Start yet.

## Considered options

- **Better Auth on Workers Paid (US$5/month)**: self-hosted and no vendor, at the cost
  of the plan and the ~90 ms password check on every sign-in. Reconsidered once Rubens
  moved to Paid, and rejected again (amendment below).
- **Better Auth with a passwordless sign-in** (email codes, passkeys): no hash to
  compute, but email delivery to build and run.
- **WorkOS AuthKit**: a higher free tier; not prototyped.
- **Clerk Organizations**: Clerk's own organization screens and invitations, but 5
  members per organization on the free plan, and Pro (about US$25/month) beyond it.

## Amended 2026-11-07: keeping Clerk on Workers Paid

On Workers Paid, Better Auth's ~90 ms password check fits the CPU limit, so the
original reason for Clerk is gone. The product owner kept Clerk anyway:

- Clerk brings protections Rubens can turn on later without building them:
  rejecting compromised passwords (HaveIBeenPwned), password strength, two-step
  verification, passkeys.
- Going back to Better Auth is a re-port, the reverse of #131. It would also need a
  user directory shared across organizations, outside the per-organization objects,
  because sign-in has to find a user before it knows their organization.

The question came up when the production Clerk application's password minimum (15)
blocked the first password change. The application's password settings are now:
minimum 8 characters, compromised passwords rejected, no minimum strength check
([infrastructure.md](../operations/infrastructure.md#the-clerk-application)).
