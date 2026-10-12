---
name: housekeeping
description: "Clean up what finished threads leave on this machine: stale git worktrees, their merged branches and their worktree databases. Use when asked for housekeeping, a cleanup, or which worktrees can be removed."
---

# Housekeeping

Nothing is removed until the user has seen what would go. A worktree that looks finished
can still be a paused thread, so the user decides.

1. **List the worktrees**: `git worktree list`. For each one other than the main
   checkout, read its state:
   - its branch and whether the PR for it is merged or closed (`gh pr list --head <branch> --state all`);
   - whether it has commits nothing else holds (`git log origin/<branch>..<branch>` when a
     remote branch exists; otherwise every commit on a local-only branch counts);
   - whether it has uncommitted changes (`git -C <path> status --short`).
2. **List the worktree databases**:
   `docker exec rubens-postgres psql -U postgres -tAc "select datname from pg_database where datname like 'rubens-wt-%'"`.
   Each one belongs to a worktree whose folder name is its slug (`scripts/worktree-db.ts`).
3. **Report** what would be removed, as a list with the reason for each: merged or
   closed PR, and the database that goes with it. Name every worktree that has
   uncommitted changes or commits nothing else holds: those are where the user's eye is
   needed, and they stay unless the user says otherwise. Then stop.

On acceptance, for each worktree the user named:

- `git worktree remove <path>` (it refuses a dirty tree, which is the point), then
  `git branch -d <branch>` for its local branch (`-D` only when the user has said the
  commits are not needed);
- `docker exec rubens-postgres dropdb -U postgres <database>` for its `rubens-wt-` database;
- `git worktree prune` at the end.

Report what was removed, anything that errored, and every worktree kept with its reason.
