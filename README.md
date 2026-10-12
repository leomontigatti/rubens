<img src="assets/icon.svg" width="64" height="64" alt="">

# rubens

Gestión de turnos e historias clínicas para un centro de salud: recepcionistas y
profesionales, varias sedes, consultorios compartidos o exclusivos.

Stack and the reasons for it: [ADR-0001](docs/adr/0001-stack.md). Tenancy and
database connection rules: [ADR-0002](docs/adr/0002-tenancy-and-database-connections.md).

## Start

```sh
cp .env.example .env            # then set BETTER_AUTH_SECRET: openssl rand -base64 32
docker compose up -d --wait postgres
pnpm install
pnpm db:migrate
pnpm dev
```

More: [local development](docs/operations/local-development.md),
[scripts](docs/operations/scripts.md). Coding agents start at [AGENTS.md](AGENTS.md).
