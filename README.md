<img src="assets/icon.svg" width="64" height="64" alt="">

# underthing

Appointments and clinical records for a health care practice: receptionists and
practitioners, several offices, shared or exclusive rooms.

It runs on Cloudflare Workers, each organization's data in a Durable Object of its
own ([ADR-0008](docs/adr/0008-cloudflare-workers-one-object-per-organization.md)),
with staff signing in through Clerk ([ADR-0009](docs/adr/0009-staff-sign-in-through-clerk.md)).
The rest of the stack: [ADR-0001](docs/adr/0001-stack.md).

## Start

```sh
pnpm install
pnpm dev                        # no keys, no account: sign in at /ingresar as a seeded member
```

More: [local development](docs/operations/local-development.md),
[deploying](docs/operations/infrastructure.md), [scripts](docs/operations/scripts.md). Coding agents start at [AGENTS.md](AGENTS.md).
