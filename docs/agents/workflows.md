# Workflows

How work flows in a local session: where it starts, which checkout it happens in,
when to investigate instead of editing, when a doc changes, and how a rendered
change is checked.

## Where work starts

Implementation happens in a local T3 Code session. A session has a browser, the
dev database and a human to ask. Three entry points, by how much is still unknown:

- **Small and clear** (a bug, a UI tweak, a one-slice feature): say it in the
  thread, or write an issue with what to build and its acceptance criteria. A
  session runs the [`implement`](../../.agents/skills/implement/SKILL.md) skill.
- **Clear but big** (known shape, several slices): `/grilling` until the shape and
  the test seams are agreed, `/to-spec` to file the PRD, `/to-tickets` to slice it
  into sub-issues, then `/implement-spec <PRD>`. The session runs every unblocked
  sub-issue at once in `implementer` subagents, merges each onto the thread's
  branch, and opens one draft PR for the chain. Details in
  [issue-tracker.md](./issue-tracker.md#prd-workflow).
- **Foggy** (decisions nobody has made yet): `/wayfinder`. The map's tickets are
  grilling, research, prototype or task. The map ends with one or more PRDs.

A request names the finish line and the allowed stops, so the session knows when
it is done and when to ask:

```
Implement #12, open the PR and babysit it.
Done means: the acceptance criteria pass, a regression test names the bug, and the
PR is ready to merge. Stop only if the seams are unclear.
```

## Investigate before implementing

A request to investigate, review, diagnose, audit or explain is a request for
findings. Return them with the relevant context, the options and their trade-offs,
and a recommended next step, then wait. Editing starts when the user asks to
implement, fix, apply or change something.

## Investigate before recommending

- **A recommendation that discards an option is a claim about that option.**
  Research the option you rule out as thoroughly as the one you argue for.
- **Mark claims as verified or inferred.** A statement about how the system
  behaves needs a `file:line` behind it. If there is none, say so.
- **The docs are not evidence about the code.** When a doc and the code disagree,
  the code is what the system does. Report the divergence.

## Branches, worktrees and T3 Code threads

Local sessions run inside [T3 Code](https://t3.codes). Every thread gets its own
git worktree and branch: `t3.json` at the repo root sets `defaultThreadEnvMode` to
`worktree`, and its setup script links `.env` from the main checkout and installs
dependencies before the agent starts. A worktree's own database and dev port come
on its first `pnpm dev` or `pnpm db:migrate` ([local-development.md](../operations/local-development.md)).

The main checkout stays on `main` and is nobody's working directory.

Rules for a session:

- **Start current.** Before the first edit of an implementation,
  `git fetch origin && git log --oneline HEAD..origin/main` prints nothing. There
  is no remote yet, so this check is skipped until one exists; see
  [issue-tracker.md](./issue-tracker.md#the-repository-has-no-remote).
- **Work where you started.** The thread's worktree is the working directory.
  Never `git checkout` or `git switch` in the main checkout, and never create a
  worktree of your own. The exception is `implement-spec`'s implementer subagents,
  each in an Agent-tool worktree under `.claude/worktrees/`, which the skill removes.
- **Branch prefixes.** A session that creates or renames a branch uses `feat/`,
  `fix/`, `docs/`, `chore/`, `refactor/`, `research/` or `prototype/`. Read the
  current name with `git branch --show-current`.
- **One thread, one branch, one PR.** After `gh pr create`, register the PR with
  the thread through the `link_pull_request` tool so T3 shows its status. The PR
  body is written with the [`pr` skill](../../.agents/skills/pr/SKILL.md).
- **Leaving a worktree behind is fine; abandoning a branch is not.** Push the
  branch or delete it. Finished worktrees are cleaned up as the
  [`housekeeping` skill](../../.agents/skills/housekeeping/SKILL.md) says.
- **Never commit without being asked.** A session commits when the run started
  from an issue, the user asked for a commit or a PR, or the run is unattended.

## Documentation

Most code changes need no documentation change: agents and maintainers read the
code. Before adding a paragraph under `docs/`, ask what a later session would get
wrong without it. If the code answers the question, leave it out.

- `docs/agents/` holds operative rules and traps that are hard to find in the
  source. `docs/domain/` holds the domain rules. `docs/adr/` holds decisions and
  their reasons. `docs/operations/` holds runbooks.
- Do not enumerate fields or functions, narrate control flow, keep file catalogues
  or append PR summaries. Types, tests and code already record them.
- When a documented rule changes, rewrite the affected text. Do not append a second
  account next to it. ADRs are records: a change is a dated amendment, and a
  reversal is a new ADR that supersedes the old one.
- A session's plan and scratch notes stay out of the repo. The issue and the PR are
  the record of the work.

## UI verification

A change to anything the dev server renders (a route, a component, a loader's
output, an action's feedback) is checked in a real browser before it is reviewed.
The browser is the Playwright CLI, `playwright-cli`, installed globally with a
headless Chromium.

Use `playwright-cli` only, never a browser the harness ships, such as T3 Code's
preview tools: their screenshots blur mid-animation and their clicks can fail when
a menu closes in between. If `playwright-cli` is missing, stop and tell the user;
do not fall back to another browser. Its scratch files (snapshots, console logs,
screenshots) go to `.playwright-cli/`, which is gitignored.

Skip this for what a browser cannot exercise: types, tests, tooling, docs, and
server code with no rendered surface.

Data comes from the worktree's own database, never from a copy of production.
Rubens has no seed script yet: create the accounts and rows the screen needs by hand,
with made-up names.

The loop:

1. **Start the dev server** with `pnpm dev`. Its port is in `.env.local` for a
   worktree; it is strict, so a port held by another server fails loudly. Stop it
   at the end with `pnpm dev:stop`, which stops only this worktree's server.
2. **Open a named session**: `playwright-cli -s=<name> open http://localhost:<port>/<path>`,
   then `resize 1440 900`. The design width is 1440; check the touched screen at
   1280 too when it has a table or a dense row.
3. **Capture the before** before the first edit: `screenshot --filename=.playwright-cli/<what>-before.png`.
   After the edit there is no before left to take.
4. **Drive the flow** with `goto`, `click`, `fill`, `select`, `press`, and confirm
   with `snapshot` (or `find "<text>"`). Assert on the snapshot; it is what the page
   exposes.
5. **Diagnose from the page**: `console` for errors, `requests` then `request <n>`
   for the network. Fix the source and go back to step 4. Done when `console` shows
   no error and no React warning on the screens the change touches.
6. **Capture the after** once the change is final, same screen, same account, same
   size.
7. **Close** with `playwright-cli -s=<name> close`. A session left open holds a
   Chromium.

Quote any URL with a query string so the shell does not expand it. Attach the two
screenshots to the PR body as described in [pull-requests.md](./pull-requests.md#ui-evidence).
Never ask the user to check a screen by hand: drive it and show the result.
