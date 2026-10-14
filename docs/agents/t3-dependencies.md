# T3 Code dependencies

What this repo's workflows assume about T3 Code. The global `t3-update-review`
skill reads this file after every T3 update; agents don't need it for everyday work.

Status of an entry:

- **active**: we rely on T3 behaving this way; an update that changes it breaks us.
- **watching**: a workaround for something T3 can't do (yet), or a workflow T3
  could do natively better, faster or cheaper. "Would improve if" is the exact
  condition that lets us simplify.
- **ready**: the condition is met in the installed T3, but we haven't adopted it yet.
- **resolved**: adopted; kept as history.

## Active

### t3-json-setup-script

- **Relies on:** `t3.json` sets `defaultThreadEnvMode` to `worktree`, and its
  `runOnWorktreeCreate` script with `async: false` runs in each new thread worktree and
  holds the agent until it exits. The default, `async: true`, starts the agent first
  (`packages/contracts/src/t3ProjectFile.ts`).
- **Used by:** `docs/agents/workflows.md` § Branches, worktrees and T3 Code threads;
  `.agents/agents/implementer.md` step 2 (the by-hand copy of this script, for worktrees T3 did not create)
- **Breaks if:** T3 stops applying `defaultThreadEnvMode` or running create-time scripts,
  or starts the agent before an `async: false` script exits.

### t3-leaves-hand-made-worktrees-alone

- **Relies on:** T3 cleans up only worktrees it created for a thread, and keeps any
  worktree outside its managed folder ("outside the managed worktree folder" in
  `apps/server/src/storageCleanup.ts`). So a worktree under `.claude/worktrees/` is
  neither set up nor removed by T3.
- **Used by:** `docs/agents/workflows.md` § Branches, worktrees and T3 Code threads
  (rule "Work where you started"); `.agents/skills/implement-spec/SKILL.md` § 2, § 3 step 4
  and § 4 step 6; `.agents/skills/housekeeping/SKILL.md` § 1 (the worktrees the sweep owns)
- **Breaks if:** T3's cleanup starts removing worktrees outside its managed folder, which
  would race the removal `implement-spec` and `housekeeping` do themselves.

### storage-cleanup-removes-thread-worktrees

- **Relies on:** T3's storage cleanup is on for this machine (`storageCleanup` in T3's
  `settings.json`: `worktreeOnMerge: true`, `worktreeOnDelete: true`,
  `worktreeKeepWhen: "uncommitted-changes"`). It removes a worktree in its managed folder
  (`~/.t3/worktrees/rubens/`) once the thread's PR merges or its last thread is deleted,
  keeps one with uncommitted changes, an open terminal or a running thread, and reports
  why it kept each one under Settings → Storage → Last run. It keeps the branch and never
  touches a `rubens-wt-` database (`apps/server/src/storageCleanup.ts`; T3 docs
  `docs/user/project-settings.md` § Storage cleanup).
- **Used by:** `.agents/skills/housekeeping/SKILL.md` (it lists T3's worktrees as left to
  T3, and sweeps their branches and orphaned databases); `docs/agents/workflows.md` §
  Branches, worktrees and T3 Code threads (rule "Leaving a worktree behind is fine")
- **Breaks if:** the settings are reset or the rules turned off (finished worktrees pile up
  and nothing removes them); `worktreeAfterDays` or `worktreeUnchanged` is turned on, since
  T3 then removes a live thread's worktree and recreates it on resume, and the sweep would
  drop its database and, with a closed PR, its branch; T3 moves its managed folder, so
  `housekeeping` would take T3's worktrees for its own; or the Last run report moves or
  stops giving a reason.

### pr-linked-by-tool

- **Relies on:** `link_pull_request` accepts a PR URL, or repository and number; a repeat
  call returns `alreadyLinked`; the linked PR's status shows beside the thread, and the
  thread settles when the PR merges (`apps/server/src/mcp/toolkits/pullRequests/tools.ts`).
- **Used by:** `docs/agents/workflows.md` § Branches, worktrees and T3 Code threads
  (rule "One thread, one branch, one PR"); `.agents/skills/implement/SKILL.md` § 7;
  `.agents/skills/implement-spec/SKILL.md` § 3, step 3
- **Breaks if:** the tool is renamed or removed, stops taking a URL, or stops showing
  status or settling the thread on merge.

### pr-watch-is-native

- **Relies on:** `watch_pull_request` links the PR if needed, has T3 check it about every
  two minutes, and wakes the thread on a failed check, passed required checks, a new
  or edited comment or review, or a conflict with the base. Only comments posted after
  the call wake the thread. A subagent thread cannot call it. `unwatch_pull_request`
  ends the watch and returns the thread to the user's inbox; it wakes no other thread.
  `list_thread_pull_requests` with another thread's `threadId` lists that thread's PRs.
- **Used by:** `.agents/skills/babysit-pr/SKILL.md` § 2 and § 5;
  `.agents/skills/implement/SKILL.md` § 7; `docs/agents/workflows.md` § Branches,
  worktrees and T3 Code threads (rule "A launched thread reports to its own inbox")
- **Breaks if:** a wake event is dropped, or a wake no longer ends the turn, so the
  session has to poll or sleep to wait; `unwatch_pull_request` stops returning the
  thread to the inbox; or `list_thread_pull_requests` stops taking another thread's id.

### renamed-branch-in-thread

- **Relies on:** a thread keeps working after its worktree's branch is renamed with
  `git branch -m`, and a PR linked by URL or number keeps its status. The link carries no
  branch name (`PullRequestTargetInput` in `apps/server/src/mcp/toolkits/pullRequests/tools.ts`).
- **Used by:** `docs/agents/workflows.md` § Branches, worktrees and T3 Code threads
  (rule "Branch prefixes")
- **Breaks if:** T3 starts resolving a thread's PR, or its state, from the branch name
  recorded when the thread started.

### subagent-review-delegation

- **Relies on:** `delegate_task` takes `task`, `target` (`providerInstanceId`, `model`,
  `options.reasoningEffort`), `role`, `mode`, `title` and `clientRequestId`. It runs the
  child in the parent's checkout by default (`isolation: shared`) and inherits the
  parent's `runtimeMode`. The child's report comes back as `summary`, on the call result
  and on `task_status`. Source: `packages/contracts/src/orchestratorMcp.ts`. Read-only
  review is a prompt rule (`.agents/agents/reviewer.md` § Rules), not something T3 enforces.
- **Used by:** `.agents/skills/code-review/SKILL.md` § Spawning a reviewer;
  `.agents/agents/reviewer.md`; `.agents/agents/research.md`;
  `docs/agents/agent-configuration.md` § Delegating to subagents
- **Breaks if:** `summary` stops carrying the child's report, `clientRequestId` stops
  deduplicating a retry, the `target` shape or live model ids change, or children stop
  sharing the parent's checkout by default.

### login-shell-path

- **Relies on:** T3, and the Claude Code and Codex sessions it starts, inherit PATH from
  the desktop login session, so a line in `~/.profile` reaches the agent's shell.
- **Used by:** `docs/agents/agent-configuration.md` § The agent shell's PATH;
  `.agents/hooks/check-tool-path.sh` (the SessionStart warning)
- **Breaks if:** T3 starts agent sessions with a shell environment of its own, so
  `~/.profile` no longer reaches them.

## Watching

### storage-cleanup-renamed-branches

- **Workaround:** `housekeeping` names a T3 worktree whose branch was renamed under "Left to
  T3" in its report; the user removes it, by hand or in T3. T3 keeps it even when its
  thread is deleted.
- **Used by:** `.agents/skills/housekeeping/SKILL.md` § 4
- **Would improve if:** T3's merged-worktree cleanup removes a worktree whose branch was
  renamed after the thread started. Today it keeps one with "repository or branch changed"
  (`apps/server/src/storageCleanup.ts`).
- **Watch:** pingdotgg/t3code#16559 and #17813 (open); #11078 (open; the sidebar keeps the
  creation-time branch name after a rename)

### storage-cleanup-archived-threads

- **Workaround:** `housekeeping` lists every worktree from `git worktree list` and names a T3
  worktree of an archived thread under "Left to T3"; the user removes it, by hand or in T3.
- **Used by:** `.agents/skills/housekeeping/SKILL.md` § 1 and § 4
- **Would improve if:** T3's storage cleanup sees archived threads' worktrees, so a worktree
  of an archived thread is removed by the rules the user has set.
- **Watch:** pingdotgg/t3code#17811 (open); fix PR pingdotgg/t3code#16473 (open)

### implementer-worktrees

- **Workaround:** `implement-spec` runs each implementer as an Agent-tool worktree under
  `.claude/worktrees/`, sets it up by hand (`.agents/agents/implementer.md` step 2), and
  removes it itself (`.agents/skills/implement-spec/SKILL.md` § 3 step 4, and § 4 step 6).
- **Used by:** `.agents/agents/implementer.md`; `.agents/skills/implement-spec/SKILL.md`;
  `docs/agents/workflows.md` § Branches, worktrees and T3 Code threads (the exception)
- **Would improve if:** a `delegate_task` child with `isolation: worktree` (a checkout of the
  parent's local commit, with project setup done before the child starts, per the tool text)
  can commit to its own named branch that the orchestrator merges. Its result has no branch
  field today (`OrchestratorMcpDelegateTaskResult` in `packages/contracts/src/orchestratorMcp.ts`).
  Not tried yet: needs a trial.
- **Watch:** `apps/server/src/mcp/toolkits/orchestrator/tools.ts` (`delegate_task`)

### preview-tools-screenshots

- **Workaround:** UI verification runs in `playwright-cli`; T3's preview tools are not used
  (`docs/agents/workflows.md` § UI verification).
- **Used by:** `docs/agents/workflows.md` § UI verification; `.agents/skills/implement/SKILL.md` § 4
- **Would improve if:** T3's preview tools wait for animations to settle before a screenshot
  and for a closing menu before a click, so they can run the loop in § UI verification.
  Not tried yet: needs a trial. No upstream issue found.
- **Watch:** `apps/server/src/mcp/toolkits/preview/tools.ts`

### pr-watch-unreported-checks

- **Workaround:** `babysit-pr` reads the state on every wake and treats a required check
  not reported yet, a check still running or `mergeStateStatus` `UNKNOWN` as not ready,
  then waits on a fresh push with the background `gh pr checks --watch` loop. A PR behind
  `main` is found the same way, by reading the state.
- **Used by:** `.agents/skills/babysit-pr/SKILL.md` § 2 (the background wait and the
  state table)
- **Would improve if:** `watch_pull_request` wakes the thread when a required check has
  not reported, and when the branch falls behind its base. Today it wakes on neither.
- **Watch:** pingdotgg/t3code#17831 (closed without merging on 2026-10-14; it added both)

### pr-auto-link

- **Workaround:** the session calls `link_pull_request` right after `gh pr create`.
- **Used by:** `docs/agents/workflows.md` § Branches, worktrees and T3 Code threads
  (rule "One thread, one branch, one PR"); `.agents/skills/implement/SKILL.md` § 7;
  `.agents/skills/implement-spec/SKILL.md` § 3, step 3
- **Would improve if:** T3 links a PR opened from the thread's branch with `gh`, without a
  call. Today the tool says to register "every pull request you open ... right after creating
  it", which implies it does not.
- **Watch:** `packages/contracts/src/threadPullRequest.ts` (`ThreadPullRequestLinkSource` has
  no branch-detected value)

## Ready

None.

## Resolved

### housekeeping-worktree-removal

- **Workaround:** `housekeeping` removed finished thread worktrees itself, after the user
  accepted the list (`git worktree remove`).
- **Met in:** 0.0.46-nightly.20261014.3105 (https://github.com/pingdotgg/t3code/pull/17563,
  merged 2026-10-10; closes pingdotgg/t3code#13836)
- **Adopted:** leomontigatti/rubens#2, with storage cleanup turned on; what the sweep relies on since is
  `storage-cleanup-removes-thread-worktrees`.
