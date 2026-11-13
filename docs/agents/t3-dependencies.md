# T3 Code dependencies

What underthing's own workflows assume about T3 Code, beyond what the shared workflow's
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
  working directory. A thread with no worktree runs no setup at all (pingdotgg/t3code#18891);
  the one case that runs the script in the main checkout is a thread launched as
  `existing_worktree` on the project root, where `pnpm install --frozen-lockfile` is harmless.
- **Used by:** `t3.json`
- **Breaks if:** T3 runs the script from another directory (a new worktree then starts with no
  `node_modules`).

### worktree-folder-names-unique

- **Relies on:** the folders T3 creates under `~/.t3/worktrees/rubens/` have distinct names, and
  keep their name when the thread's branch is renamed. A worktree's dev port is derived from its
  folder name (`choosePort` in `scripts/worktree-port.ts`), not from the branch.
- **Used by:** `scripts/worktree-port.ts`
- **Breaks if:** T3 reuses a folder name for a second live worktree; the port then starts from
  the same hash, and only the claimed-port check keeps the two apart.

### agent-memory-limit

- **Relies on:** on Linux with `systemd-run`, T3 puts every agent in one systemd slice with
  `MemoryHigh` at RAM minus 6 GB, at least half of RAM, and `MemoryMax` at RAM minus 4 GB, at
  least three quarters of RAM. Agent threads on the machine share that one limit, and past
  `MemoryMax` the kernel kills an agent (`agentSliceMemoryLimits` in `apps/server/src/process/agentScope.ts`; pingdotgg/t3code#27176).
- **Used by:** `docs/agents/validation.md` § Why not `pnpm test`
- **Breaks if:** T3 gives each thread its own limit or drops the shared one; then a whole
  `pnpm test:workers` no longer competes with other threads.

### scheduled-task-weekly

- **Relies on:** a T3 scheduled task with a `fixed_time` schedule runs on its weekday while this
  machine and T3 are up, with no turn active, and its run can launch a worktree thread with
  `t3_thread_launch` (`startFromOrigin: true`), whose worktree gets the `t3.json` setup script.
  Nothing relies on a missed run being made up later: the next run updates to the newest
  versions anyway.
- **Used by:** [dependency-updates.md](./dependency-updates.md) § The scheduled task
- **Breaks if:** T3 stops running scheduled tasks unattended, a scheduled run can no longer
  launch a thread, or a launched worktree no longer runs the setup script (the run then starts
  with no `node_modules`). npm packages then stop being bumped, and nothing else says so.

## Watching

None.

## Ready

None.

## Resolved

None.
