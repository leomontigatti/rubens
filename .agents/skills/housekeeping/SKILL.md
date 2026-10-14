---
name: housekeeping
description: "Clean up what finished threads leave on this machine that T3's storage cleanup does not: merged branches, worktree databases, and worktrees T3 does not manage. Use when asked for housekeeping, a cleanup, or which worktrees can be removed."
---

# Housekeeping

T3's storage cleanup removes the worktrees T3 created, those under `~/.t3/worktrees/rubens/`,
once their PR merges or their last thread is deleted. It keeps their branches and never touches
a `rubens-wt-` database. This skill sweeps up after it, and removes nothing until the user has
seen what would go: a worktree that looks finished can still be a paused thread.

1. **List the worktrees**: `git worktree prune`, then `git worktree list`. For each one other
   than the main checkout, read its state:
   - its branch and whether the PR for it is merged or closed (`gh pr list --head <branch> --state all`);
   - whether it has commits nothing else holds (`git log origin/<branch>..<branch>` when a
     remote branch exists; otherwise every commit on a local-only branch counts);
   - whether it has uncommitted changes (`git -C <path> status --short`).

   A worktree under `~/.t3/worktrees/rubens/` is T3's: list it as left to T3's storage
   cleanup, never to remove. Every other one, such as an Agent-tool worktree under
   `.claude/worktrees/`, is the sweep's.

2. **List the branches** whose worktree is gone: local branches checked out nowhere whose PR is
   merged or closed (`git branch --format='%(refname:short) %(worktreepath)'`, then the PR check
   above). T3 removes a worktree and leaves its branch behind.
3. **List the worktree databases**: `pnpm db:worktree prune` lists every `rubens-wt-` database
   whose worktree is gone, including those whose worktree T3 removed. A database belongs to
   the worktree whose folder name is its slug (`scripts/worktree-db.ts`).
4. **Report**, as lists with the reason for each:
   - **Would remove**: the worktrees the sweep owns whose PR is merged or closed, the branches
     of step 2, and the databases of step 3 plus those of the worktrees removed here.
   - **Left to T3**: the T3 worktrees still listed. Why T3 kept each one is under Settings →
     Storage → Last run. T3 never removes a worktree whose branch was renamed or whose thread
     is archived; name those, since only the user frees them, by hand or in T3.
   - **Needs the user's eye**: every worktree the sweep owns that has uncommitted changes or
     commits nothing else holds. These stay unless the user says otherwise.

   Then stop.

On acceptance, for what the user named:

- `git worktree remove <path>` for each worktree the sweep owns (it refuses a dirty tree, which
  is the point), then `git branch -d <branch>` for its local branch;
- `git branch -d <branch>` for each branch of step 2 (`-D` only when the user has said the
  commits are not needed);
- `git worktree prune`, then `pnpm db:worktree prune --apply`: it drops every database whose
  worktree is gone, the ones step 3 listed and those of the worktrees just removed. When the
  user spared a database, drop the others one at a time instead
  (`docker exec rubens-postgres dropdb -U postgres <database>`).

Report what was removed, anything that errored, every worktree kept with its reason, and the
worktrees left to T3.
