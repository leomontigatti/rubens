# ADR-0012: A directory Durable Object finds the organization of a WhatsApp number

Date: 2026-11-09. Decided by the business owner on 2026-11-07 (#158), built in #159.

Meta sends every WhatsApp webhook call for every practice to the one Worker route,
`/api/whatsapp`. The call names the phone number id (and, for a template's status, the
WhatsApp Business account id), not the organization. Every organization's data lives in
its own object ([ADR-0008](./0008-cloudflare-workers-one-object-per-organization.md)),
so the route has to find whose object a call goes to before it can store it.

We keep that lookup in **one SQLite-backed Durable Object, the WhatsApp directory**
(`src/server/whatsapp-directory.ts`): one row per organization, mapping its connected
phone number id and its WhatsApp Business account id to the organization id. The
organization's object writes it when an admin connects a number through Embedded Signup
or disconnects it; the webhook reads it. A number or an account already mapped to
another organization is refused, so a second organization cannot take over a number's
messages.

It is the one piece of state shared across organizations, and the exception to
ADR-0008's rule that each organization's data stays in its own object. It holds ids
only, never a patient's data, a token or a message: losing it loses no data, since each
organization's object still holds its own connection and could write it again.

## Considered options

- **Workers KV**: cheap reads at the edge, but eventually consistent, so the first
  messages to a just-connected number could miss the mapping and be dropped. It also
  cannot refuse a second organization claiming the same number atomically.
- **D1**: a whole database, with its own migrations and tooling, for one table of ids.
- **A directory Durable Object** (chosen): strongly consistent, a claim and its check run
  in one event, it works on the plan underthing runs on, and it uses the same tooling as
  the organization's object.

## Consequences

- One object serves every webhook call, so it is a single point of throughput. A lookup
  is one indexed read per call; at underthing's scale (a few practices, a few thousand
  messages a day) that is far below what one object serves. Caching the mapping in the
  Worker would be the next step if it ever is not.
- A call for an id the directory does not have is dropped with a 200, so Meta does not
  retry it. A call for an organization whose object was never set up answers 500, so Meta
  retries it for up to 7 days while the mapping is corrected.
- The Worker's configured test number (`WHATSAPP_PHONE_NUMBER_ID` and
  `WHATSAPP_ORGANIZATION_ID`) is looked up before the directory and stays for
  development; a real practice's number is only ever in the directory.
