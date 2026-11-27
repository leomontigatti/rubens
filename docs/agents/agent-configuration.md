# Agent configuration

How Claude Code and Codex get this repo's instructions, skills, hooks and subagents, and how a
session delegates.

## The shared workflow and what stays here

The skills and the agent briefs (`reviewer`, `research`, `implementer`) live once, in `leomontigatti/agent-workflow`, installed at user
level through `~/.agents/workflow` by its `install.sh`. Which model each role runs on is that
repo's `agents/models.md`. This repo keeps only its own facts, in the files the shared
`contract.md` lists, and the wiring a harness reads from the project:

| What                  | Here                                           | Claude Code reads it through                 | Codex reads it through |
| --------------------- | ---------------------------------------------- | -------------------------------------------- | ---------------------- |
| Repo instructions     | `AGENTS.md`                                    | `AGENTS.md` directly (no `CLAUDE.md`)        | `AGENTS.md` directly   |
| Project hooks         | `.agents/hooks/*.sh`                           | the `hooks` block of `.claude/settings.json` | `.codex/hooks.json`    |
| Permissions, launcher | `.claude/settings.json`, `.claude/launch.json` | directly                                     | none                   |

- **`AGENTS.md` is the only instructions file.** There is no `CLAUDE.md`: Claude Code reads
  `AGENTS.md` directly while no `CLAUDE.md` sits in the working directory or above it, so adding
  one would silently stop it reading these instructions. Claude-only notes go in
  `~/.claude/CLAUDE.md`.
- **A skill only underthing uses** goes in `.agents/skills/<name>/`, under a name no shared skill
  has, with a link to it in `.claude/skills/<name>` so Claude Code sees it. A change to a shared
  skill is a PR to `leomontigatti/agent-workflow`.
- **Skills a dependency ships** are not linked by pnpm: its approval takes every skill a package
  has, so `pnpm-workspace.yaml` denies them under `permissions`, and a new package asking for it
  shows in `pnpm permissions list`. The ones worth having are copied one by one from the installed
  package with the `skills` CLI, which writes both places and records each in `skills-lock.json`:
  `react-router` and `router-query` (`@tanstack/react-router`), `react-start`
  (`@tanstack/react-start`) and `fallow`. The CLI is a devDependency, run with `pnpm exec`, so its
  version passes `minimumReleaseAge` like any other. A copy does not follow the package: the
  weekly dependency task copies every entry again after its bump
  ([dependency-updates.md](./dependency-updates.md#the-run)). To add one, with telemetry off,
  `DISABLE_TELEMETRY=1 pnpm exec skills add ./node_modules/<package> -s <skill> -a codex -a claude-code -y`.
  They are kept as published, so formatting, lint, the type check and fallow skip them.
- **A hook change is a change to the script.** Adding or removing a project hook touches both
  wiring files, which carry the same events and matchers. The scripts read either payload:
  Claude Code's `tool_input.file_path`, or a Codex patch in `tool_input.command`.
- **Codex reads `.codex/` from the main checkout**, even in a worktree, so a new hook reaches a
  worktree only once it is on the branch the main checkout has out. `AGENTS.md` comes from the
  worktree itself.
- **Codex runs a project hook only once the project is trusted**, and each hook is approved the
  first time Codex offers it.

## Session hooks

Hooks are configuration, so they run in a headless Claude Code or Codex session too. A Capy
thread runs none of them and does their work itself ([validation.md](./validation.md#hooks-inside-the-session)).
The project's two:

- **`PostToolUse` on `Write|Edit`**: `format-edited-file.sh` runs `vp fmt` on each file the
  tool just wrote, silently, for the extensions Oxfmt formats.
- **`Stop`**: `stop-typecheck-lint.sh` runs `vp check --no-fmt` (lint and type check),
  `pnpm check:fallow` and `pnpm check:dupes`, and **blocks** with exit 2 while any is red, putting
  the failing output in front of the agent. Before them it blocks with a single `pnpm install --frozen-lockfile` line
  when `pnpm-lock.yaml` is newer than the installed dependencies, instead of the import errors a
  stale `node_modules` would produce. On a `prototype/*` branch it skips the two fallow gates
  ([verification.md](./verification.md#prototype)). It runs only when the working tree has a TypeScript or
  JavaScript file or a `package.json` or `tsconfig` change, and it reads the uncommitted tree, so
  it also reports failures in files the turn did not touch.

`SKIP_STOP_CHECKS` set to any value is the local bypass. The `Stop` gate keeps blocking while
the failure persists; Claude Code force-closes the turn after 8 consecutive blocks.

The shared workflow wires no hooks since agent-workflow#159, so nothing refuses `pkill -f`,
whose pattern matches the agent's own Bash call; `pnpm dev:stop` stops this worktree's dev
server instead.

## Delegating to subagents

A subagent costs a full orientation and returns only its summary, so delegate by the size of the
read, not the size of the task:

- Reading one to three files to decide or verify something is inline work.
- Understanding that needs four or more files is one narrow mapping subagent, which returns the
  conclusion, not the file dumps.
- Bulk output (a long diff, a log, a rendered page) goes to a subagent when only its conclusion
  is needed in the main thread.
- Bash for state (`git`, `gh`) stays inline.

Brief a subagent with the exact paths to read, never a digest of them, and ask for its report as
text in a fixed shape. A subagent whose last action is a tool call returns the tool result
instead of its report.

Reading outside the repo goes to the shared `research` agent, on the model and route the shared
`agents/models.md` gives the Research role; its preferred sources for this stack are
[research.md](./research.md).
