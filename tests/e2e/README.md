# Browser suite

Playwright specs that drive the production build in Chromium, as a signed-in member
reaches it. They prove what no unit or DB test can: routes, loaders, hydration, and
the browser-only races a save or a slow search opens. `pnpm test:e2e` runs them
locally, and the `e2e` job in `.github/workflows/ci.yml` runs them on every PR.

## Running

```sh
pnpm test:e2e                                  # the whole suite
pnpm test:e2e tests/e2e/booking.spec.ts        # one spec: what a session runs for the flow it touched
```

Each run builds the app (`pnpm build`), rebuilds the suite's own database
(`prepare.ts`), and starts the build on its own port (`playwright.config.ts`). The
database sits beside the one `.env` and `.env.local` name, with `_e2e` added
(`rubens_e2e`, or `rubens-wt-<worktree>_e2e`), and the port is `PORT` plus 10000, so
a run never touches the dev data or a dev server. Postgres must be up
(`docker compose up -d --wait --no-recreate postgres`). The first run on a machine
needs the browser: `pnpm exec playwright install --only-shell chromium`.

A failure leaves its trace and screenshots in `test-results/e2e/`; `pnpm exec
playwright show-trace <trace.zip>` replays one. CI uploads them as the `e2e-traces`
artifact.

## What knows the backend

The specs know the app only through the browser and `world.test-support.ts`, the seeded data, so they prove the app
the same before and after a change of backend (ADR-0008, ADR-0009). Two files know it,
and a port swaps those alone:

- `prepare.ts`: drops, migrates and seeds the database, through the services the app
  calls, as the app role.
- `auth.setup.ts`: the `setup` project signs each role in through `/ingresar` once and
  saves its browser state under `.auth/`, which every spec starts from.

No spec queries the database or calls the auth server.

## Writing a spec

- Locate by role and accessible name or label. Assert on structure and on the data the
  spec chose (a name, a date, a time), never on a sentence the app shows
  ([coding-standards.md](../../docs/agents/coding-standards.md#testing)).
- A race spec holds the server with `holdServerFunctions` and checks the whole window:
  a retrying assertion passes as soon as the right state replaces the wrong one, so
  sample the page while the call is held, or record every address it shows.
- Data a spec changes is its own: it registers the patient it books, or writes a value
  no other spec writes, so the specs pass in any order and side by side. Every
  `pnpm test:e2e` starts from a fresh seed.
- No retries: a spec that needs one is a flake to fix, and the job becomes required
  only after weeks without one.
