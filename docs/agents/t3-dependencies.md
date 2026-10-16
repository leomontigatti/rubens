# T3 Code dependencies

What Rubens' own workflows assume about T3 Code, beyond what the shared workflow's
`t3-dependencies.md` (in `leomontigatti/agent-workflow`) records for the shared skills, agents
and hooks. The `t3-update-review` skill reads both after every T3 update; agents don't need it for
everyday work.

Status of an entry:

- **active**: we rely on T3 behaving this way; an update that changes it breaks us.
- **watching**: a workaround for something T3 can't do (yet), or a workflow T3
  could do natively better, faster or cheaper. "Would improve if" is the exact
  condition that lets us simplify.
- **ready**: the condition is met in the installed T3, but we haven't adopted it yet.
- **resolved**: adopted; kept as history.

## Active

### setup-script-cwd

- **Relies on:** T3 runs the `runOnWorktreeCreate` script with the thread's worktree as its
  working directory, or the project root for a thread with no worktree, and with
  `T3CODE_PROJECT_ROOT` set to the main checkout. `t3.json`'s script tells the two apart by
  comparing `pwd -P` with `T3CODE_PROJECT_ROOT`: in the main checkout it does nothing, since
  linking `.env` onto itself fails; in a worktree it links the main checkout's `.env` and runs
  `pnpm install --frozen-lockfile`.
- **Used by:** `t3.json`
- **Breaks if:** T3 runs the script from another directory, or stops passing
  `T3CODE_PROJECT_ROOT` (the script then skips setup everywhere and a new worktree starts with
  no `.env` and no `node_modules`).

### worktree-folder-names-unique

- **Relies on:** the folders T3 creates under `~/.t3/worktrees/rubens/` have distinct names, and
  keep their name when the thread's branch is renamed. A worktree's database and dev port are
  derived from its folder name (`worktreeDatabaseName` in `scripts/worktree-db.ts`), not from the
  branch.
- **Used by:** `scripts/worktree-db.ts`; `docs/agents/housekeeping.md`
- **Breaks if:** T3 reuses a folder name for a second live worktree, which would share one
  database between two threads, or renames a folder in place, which would orphan its database.

## Watching

None.

## Ready

None.

## Resolved

None.
