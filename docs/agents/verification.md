# Verification

How a session proves a change a user can see: a route, a component, a loader's output, an
action's feedback. The shared `implement` skill runs this at its step 4, and takes the
**before** at step 1, before the first edit. Skip it for what a browser cannot exercise: types,
tests, tooling, docs, and server code with no rendered surface. A browser check is not a
validation command, and CI does not run it.

## Launch

1. `docker compose up -d --wait --no-recreate postgres`. The local Postgres container,
   `rubens-postgres`, is shared by every worktree; `pnpm dev` starts it only on a worktree's
   first run, so start it yourself every time. `--no-recreate` keeps a running container: its
   bind mount resolves to each worktree's own path, so a plain `up` from another worktree
   recreates it and drops every other worktree's sessions.
2. `pnpm dev`. On its first run in a worktree it creates the worktree's own database and port
   (`pnpm db:worktree ensure`, [local-development.md](../operations/local-development.md#one-database-per-worktree)),
   and writes both to the gitignored `.env.local`. Run `pnpm db:migrate` when the branch adds a
   migration.
3. The URL is `http://localhost:<PORT>` with `PORT` from `.env.local`. The port is strict: a
   port another server holds fails loudly instead of moving.

Data comes from the worktree's own database, never from a copy of production. Rubens has no seed
script yet: `pnpm setup:organization` creates an organization and its first admin
([scripts.md](../operations/scripts.md#database)); create the other rows the screen needs
by hand, with made-up names.

## Doctor

When the launch fails, check in this order:

- **No database**: `docker compose ps postgres` shows it healthy; if not, start it as § Launch says. A
  migration error on `pnpm dev` is the branch's to fix, never a reason to drop the database.
- **No `.env`**: the worktree's `.env` is a link to the main checkout's (`t3.json`). A missing
  `BETTER_AUTH_SECRET` is the user's to set there.
- **Port in use**: `pnpm dev:stop` stops this worktree's own server; a port held by another
  worktree's server is that thread's, so leave it.
- **`node`, `pnpm` or `playwright-cli` not found**: the `SessionStart` warning names it; the fix
  is the user's ([the agent shell's PATH](./agent-configuration.md#the-agent-shells-path)).

## Drive

In a T3 thread, drive with T3's preview tools, as the shared `implement` skill's `PREVIEW.md`
says. Rubens runs the preview-tools trial first: note in the final report every capture that
blurred and every click that missed.

- The design width is 1440 × 900; check the touched screen at 1280 too when it has a table or a
  dense row.
- Done when the touched screens show no console error and no React warning.

**Fallback outside T3**: the Playwright CLI, `playwright-cli`, installed globally with a headless
Chromium. Its scratch files go to `.playwright-cli/`, which is gitignored.

1. `playwright-cli -s=<name> open "http://localhost:<port>/<path>"`, then `resize 1440 900`.
2. Drive with `goto`, `click`, `fill`, `select`, `press`, and confirm with `snapshot` (or
   `find "<text>"`). Assert on the snapshot; it is what the page exposes.
3. Diagnose with `console` for errors, `requests` then `request <n>` for the network.
4. Capture with `screenshot --filename=.playwright-cli/<what>-before.png` (and `-after`).

Quote any URL with a query string so the shell does not expand it. If `playwright-cli` is
missing outside T3, stop and tell the user.

## Evidence

A change to what a screen looks like is shown as a before and an after image, same screen,
account and size; a change to motion or interaction as a short recording instead.

- **Approved in the thread, never uploaded.** Show the captures to the user in the reply, each
  embedded by its absolute path, for approval before the PR opens. The PR carries no images.
- **Made-up data only.** Screenshots show names and appointments: never put a real patient's data
  on screen for a capture.
- Never commit evidence images to the repo.

## Cleanup

- `pnpm dev:stop` stops this worktree's dev server, found by its port and working directory.
  Never `pkill -f`.
- Close every preview tab you opened with `t3_preview_close`; outside T3,
  `playwright-cli -s=<name> close`, since a session left open holds a Chromium.
- Leave the Postgres container running: other worktrees use it.

## Feature map

Which flow proves which area. The app is a skeleton today; add a row when a screen lands.

| Area                                                                                                            | Flow that proves it                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document shell, theme (`__root.tsx`, `styles.css`)                                                              | Open `/`, at 1440 and 1280, light and dark; no console error.                                                                                                                                                                                                                                         |
| Sign-in and app shell (`ingresar.tsx`, `_app.tsx`, `_app/index.tsx`, `src/lib/auth*.ts`, `src/server/actor.ts`) | Signed out, `/` lands on `/ingresar`. Sign in as an admin from `setup:organization`: held on `/cambiar-contrasena` until the starting password is replaced, then `/` shows the organization name. The user menu changes the password and signs out. `curl` `POST /api/auth/sign-up/email` is refused. |
| A UI component (`src/components/ui/`)                                                                           | Every screen that uses it, in each state the change touches.                                                                                                                                                                                                                                          |
