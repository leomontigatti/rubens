# Production infrastructure

What production needs, how to deploy it, and what is still open. Items marked **TBD**
have no value and must not be guessed at.

## Shape

One Cloudflare Worker, `rubens` (`wrangler.jsonc`), on Workers Paid, US$5/month
([ADR-0008](../adr/0008-cloudflare-workers-one-object-per-organization.md)). It serves
the app and holds one SQLite-backed Durable Object per organization (`ORGANIZATION`,
class `Organization`), which keeps all of that organization's data and applies its own
migrations when it starts. Staff sign in through Clerk
([ADR-0009](../adr/0009-staff-sign-in-through-clerk.md)); the Worker only verifies
Clerk's session token. There is no server, database or container to run.

Deploys are manual: a person runs them from a checkout of `main`. Pushing to `main`
deploys nothing.

## Status

Not deployed for a real organization. Still TBD:

- The Cloudflare account that owns production, the domain and the DNS record for the app.
- Backups of the objects' storage beyond Cloudflare's own (below).
- Alerting channel and who receives it.

Counsel confirmed on 2026-11-05 that the data may be stored in the United States, where
Cloudflare creates the objects today (ADR-0008). The AAIP registration and patient
consent are still to be done before real patient data goes in.

## The Clerk application

One Clerk application per environment, created in Clerk's dashboard:

- **Sign-in**: email and password. No public sign-up: members are created by Rubens
  (the setup script, then the staff screens).
- **Session token claims** (Configure → Sessions → Customize session token):

  ```json
  {
    "org": "{{user.public_metadata.organizationId}}",
    "roles": "{{user.public_metadata.roles}}"
  }
  ```

  Without `org` every signed-in user is refused. Rubens writes both fields of the public
  metadata when it creates a member.

- **Passwords** (the password settings in Clerk's dashboard):
  - minimum length 8 (Clerk recommends 15; Clerk's maximum is 72 bytes, so a letter with an accent takes two and an emoji four);
  - reject compromised passwords: on;
  - enforce minimum password strength: off.

  Rubens' own length check (`src/lib/password-change.ts`) uses the same 8 and 72: change
  them together.

- **Keys**: the publishable key (`pk_…`) and the secret key (`sk_…`), from API keys.

## Worker secrets

Set with `pnpm exec wrangler secret put <NAME>`, which prompts for the value and
deploys a new version with it. Never in `wrangler.jsonc`, the repository or a `.env`
that is committed.

| Secret                  | What it does                                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLERK_SECRET_KEY`      | Verifies session tokens and calls Clerk's Backend API. Without it a deployed Worker refuses every request (`src/server/caller.ts`).                                                                                                                  |
| `CLERK_PUBLISHABLE_KEY` | Served to the browser for Clerk's sign-in. Required beside the secret key.                                                                                                                                                                           |
| `SETUP_SECRET`          | Lets `pnpm setup:organization` create an organization. Without it `/api/setup` answers 404. Remove it when no setup is pending.                                                                                                                      |
| `META_APP_SECRET`       | Meta's app secret, which signs each call to the WhatsApp webhook (`/api/whatsapp`). Without it the webhook answers 404.                                                                                                                              |
| `WHATSAPP_VERIFY_TOKEN` | The verify token entered in Meta's app dashboard when the webhook is set up. Without it the verification answers 404.                                                                                                                                |
| `WHATSAPP_ACCESS_TOKEN` | The access token of `WHATSAPP_PHONE_NUMBER_ID`, which the WhatsApp settings page (`/whatsapp`) sends templates with. Without it the page shows sending disabled. Use a system user's token: the dashboard's temporary one expires after about a day. |

Two more names are configuration rather than secrets, set the same way so a deploy
keeps them: `WHATSAPP_PHONE_NUMBER_ID`, Meta's test number (which the webhook
expects and the WhatsApp settings page sends from), and
`WHATSAPP_ORGANIZATION_ID`, the organization its messages are stored in. Embedded
Signup (#159) replaces the pair with each organization's own connection.

`DEV_SIGN_IN` is never set on a deployed Worker: it would let anyone sign in as any
member.

## Deploy

From a clean checkout of the commit to deploy, with `pnpm install` done:

1. **Sign in to Cloudflare**: `pnpm exec wrangler login`, as the account that owns the
   Worker.
2. **Build and deploy**: `pnpm build`, then `pnpm exec wrangler deploy`. The build writes
   the deploy config wrangler picks up. The first deploy creates the Worker, the
   `ORGANIZATION` binding and the object class (the `v1` migration in `wrangler.jsonc`),
   and prints the Worker's URL.
3. **Set the secrets** (above): `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY` on the
   first deploy, and `SETUP_SECRET` when an organization is to be created.
4. **Create the organization** and its first admin:

   ```sh
   SETUP_SECRET=<the value set above> pnpm setup:organization --url https://<worker url> \
     --organization "<name>" --name "<admin name>" --email <admin email> \
     --password <starting password>
   ```

   The admin is created in Clerk and in the organization's member table, and must
   replace the starting password at first sign-in. A second run for the same
   organization changes nothing and says so. Then
   `pnpm exec wrangler secret delete SETUP_SECRET`.

5. **Check it**: sign in at `https://<worker url>/ingresar` as the admin.

A later deploy is steps 2 and 5. A schema change ships with its migration, which each
object applies on its next start; a migration on `main` is never edited.

Rollback: `pnpm exec wrangler rollback` returns to the previous version. An object
that already ran a newer migration keeps its schema, so a rollback is only safe when
the migration was additive.

To remove a deployed copy (a test or measurement deploy):
`pnpm exec wrangler delete`. Check in Cloudflare's dashboard that the Worker and its
Durable Object namespace are gone, and delete that copy's Clerk application if it had its own.

## CPU

Workers Paid allows 30 s of CPU per request by default, configurable up to 5 minutes,
and includes 10 million requests and 30 million CPU ms a month; beyond that, US$0.30 per
million requests and US$0.02 per million CPU ms (ADR-0008). Watch a deploy's CPU in the
Worker's metrics on Cloudflare's dashboard (`observability` is on in `wrangler.jsonc`).

Measured deployed on 2026-11-06, a signed-in page takes about 20–30 ms of CPU (the agenda
week a median 20–21 ms, a plain page 29 ms, 91 ms at most), and a server-function call
about 2 ms. That is over the free plan's 10 ms, which is why Rubens is on Paid. #143 has
the measurements and how to take them again.

## Backups

Cloudflare keeps a SQLite-backed object's storage with point-in-time recovery for the
last 30 days. Whether that is enough, or the objects also export to storage of our own,
and the restore drill, are **TBD**. Clinical records are kept at least ten years
(ADR-0003), so retention is a legal question, not only an operational one. A backup
nobody has restored is a hope, not a backup.

## Logs, errors and alerts

No patient data in logs, error messages or alerts. That covers names, phone numbers,
appointment times, notes and anything else identifying. Concretely:

- do not log request or response bodies on the server path;
- thrown error messages name the failure, never the record;
- Workers logs (`observability` in `wrangler.jsonc`) are kept by Cloudflare: treat them
  as containing no patient data by construction, not by filtering.

Staff identities (names, emails, passwords) live in Clerk; patients have no accounts,
so no patient data is in Clerk.
