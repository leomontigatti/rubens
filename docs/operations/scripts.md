# Scripts

Every script in `package.json`, one line each. ⚠️ marks a script that writes data
or deletes or rewrites files. The script names are a contract: CI and the git hook
call them by name, so renaming one means editing those too.

Scripts that call `scripts/*.ts` run under `tsx`.

## Development

- `dev`: `scripts/worktree-port.ts` (writes this worktree's own port to `.env.local` on
  first use; nothing in the main checkout), then `vp dev`, the dev server on `PORT`
  (default 3000): the Worker and the organization objects in Miniflare, with the dev
  sign-in when no Clerk key is set. Strict port: if the port is taken, it fails rather
  than moving.
- `dev:url`: prints this checkout's dev URL, `http://localhost:<PORT>`, the port `pnpm dev`
  serves on (`scripts/worktree-port.ts --print`, writing it to `.env.local` first when
  none is written yet).
- `dev:stop`: stops the dev server this worktree runs, by port and working directory.
  It does not touch other worktrees' servers, and exits 1 if the port is held from
  outside this worktree.
- `routes:generate` ⚠️ rewrites `src/routeTree.gen.ts` from the route files. Generated,
  so only ever regenerate it, never edit it.

## Build and checks

- `build`: `vp build`. Produces the Worker and its assets under `dist/`, and the deploy
  config `wrangler deploy` and `wrangler dev` pick up ([infrastructure.md](./infrastructure.md#deploy)).
- `check`: `vp check`: format check, lint and typecheck. This is what CI runs.
- `check:fix` ⚠️ `vp check --fix`: rewrites files in place to fix what it can.
- `typecheck`: `vp check --no-fmt --no-lint`. Typecheck only; the pre-commit hook runs it.
- `lint`: `vp lint`, Oxlint with the type-aware rules configured in `vite.config.ts`.
- `format`: `vp fmt`. Rewrites files in place.
- `format:check`: `vp fmt --check`. Reports, changes nothing.
- `check:dependency-audit`: fails on high and critical advisories this branch
  introduces, against `origin/main`. CI runs it.
- `check:fallow`: `fallow audit` gated on what this branch adds against `origin/main`
  ([fallow.md](../agents/fallow.md)). The pre-commit hook and CI run it.
- `check:dupes`: `fallow dupes --quiet`, failing when duplicated lines pass
  `duplicates.threshold` (3%) of the whole codebase ([fallow.md](../agents/fallow.md)).
  The pre-commit hook and CI run it.
- `check:pr-title`: the conventional-commit prefix and English subject rule, over the
  `PR_TITLE` environment variable. CI runs it on PR events.
- `check:labels`: fails when a workflow, a script or a doc under `docs/agents/` names
  a label `.github/labels.json` does not hold. It reads a label in a `gh` `--label`
  flag (in a doc, inside code only), a workflow condition, a jq `==` and any
  `priority:` or `wayfinder:` name; a bare `bug` or `question` is prose to it. CI
  runs it.
- `check:comment-language`: fails on Spanish prose in comments, test names, thrown
  `Error` messages, shell stderr, `#` and SQL `--` comments, and markdown, over the whole tree.
  Spanish marked as data (double-quoted in code, backticked in markdown) passes;
  `docs/adr/`, `docs/research/` and `docs/operations/whatsapp-templates.md` are
  exempt. CI runs it.
- `check:file-tokens`: fails on a tracked `.ts`/`.tsx` file under `src/` above
  5,500 estimated tokens (bytes / 4). Tests and generated files are exempt. CI
  runs it.

## Repository

- `labels:sync` ⚠️ pushes `.github/labels.json` to the GitHub repo's labels with `gh`:
  creates the missing ones and rewrites the colour and description of those that
  differ. It never deletes: a live label the file does not hold is listed and left
  alone. `--dry-run` (`pnpm labels:sync --dry-run`) prints the plan and changes nothing.

## Tests

- `test`: `test:unit` then `test:workers`.
- `test:unit`: `vp test --run --project unit`, the `*.test.ts(x)` files.
- `test:workers`: `vp test --run --project workers`, the `*.workers.test.ts` files in the
  Workers runtime (Cloudflare's Vitest plugin): the organization object's methods on real
  SQLite storage, and the request-to-caller step. No service or account needed.
- `test:e2e` ⚠️ `pnpm build`, then `tests/e2e/prepare.ts`, which deletes the suite's own
  object storage (`.wrangler/e2e-state`), then `playwright test`: the browser suite against
  the production Worker, served by `wrangler dev` with the dev sign-in on `PORT` plus 10000.
  The build seeds the dev organization on its first sign-in page. Arguments go to
  Playwright, so `pnpm test:e2e tests/e2e/<spec>` runs one spec. It never touches the dev
  data. CI runs it in the `e2e` job ([tests/e2e/README.md](../../tests/e2e/README.md)).
- `eval:assistant`: the patient assistant's evaluation (#157), each booking conversation in
  `tests/evals/assistant/` on the named model candidates, under plain Node. Calls the
  providers' APIs and costs money, so it runs on demand with their keys, never in CI
  ([tests/evals/assistant/README.md](../../tests/evals/assistant/README.md)).
- `eval:voice`: the voice notes through each transcription option, then the transcript
  through one candidate. On demand, like `eval:assistant`.
- `eval:report`: re-scores saved `eval:assistant` runs with today's checks and folds them
  into one table. Offline: no API calls.

## The organization's data

- `organization:generate` runs `drizzle-kit generate` with `drizzle.organization.config.ts`:
  diffs `src/organization/schema.ts` and `whatsapp-schema.ts`, the organization object's SQLite schema, against its
  snapshot and writes the migration and `migrations.js` index under
  `src/organization/migrations`, which the object applies on start. Offline. Commit what it
  writes, and never edit a migration that is already on `main`.
- `setup:organization` ⚠️ runs `scripts/setup-organization.ts`: creates an organization
  and its first admin, with `--url <worker url> --organization "<name>" --name "<admin name>"
  --email <email> --password <starting password>`, and `SETUP_SECRET` in the environment,
  the Worker's secret of that name. It posts to the Worker's `/api/setup`, and the
  organization's object creates the admin in Clerk and in its member table. There is no
  public sign-up, so this is how a business comes to exist. A second run for the same
  organization name changes nothing and says so. The admin must replace the starting
  password at first sign-in. Dev needs none of it: the dev sign-in seeds its own
  organization.

## Lifecycle

- `prepare`: `vp config --no-agent || true`. Runs on every `pnpm install`. Installs the
  Vite+ git hook dispatcher into `.git`. Skip it with `VP_GIT_HOOKS=0`, or turn hooks off
  for a clone with `vp hooks disable` (`docs/operations/local-development.md`).
