# Housekeeping

underthing's per-worktree resources, for the shared `housekeeping` skill.

## Worktree state

A worktree's dev port lives in its gitignored `.env.local`, and its local Worker state (the dev
organization's objects, the browser suite's `.wrangler/e2e-state`) in its gitignored `.wrangler/`.
Both sit inside the worktree folder and go with it, so nothing outside a removed worktree is left
to sweep. A `.env.local` written before the port to Workers (#131) also names a `rubens-wt-<slug>`
Postgres database; those databases and the `rubens-postgres` container are no longer used, and
removing them is the user's call.
