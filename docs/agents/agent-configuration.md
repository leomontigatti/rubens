# Agent configuration

How Claude Code and Codex get this repo's instructions, skills, hooks and subagents, and how a
session delegates.

## The shared workflow and what stays here

The skills, the agent briefs (`reviewer`, `research`, `implementer`), their harness wrappers and
the project-independent hooks live once, in `leomontigatti/agent-workflow`, installed at user
level through `~/.agents/workflow` by its `install.sh`. Which model each role runs on is that
repo's `agents/models.md`. This repo keeps only its own facts, in the files the shared
`contract.md` lists, and the wiring a harness reads from the project:

| What                  | Here                                           | Claude Code reads it through                 | Codex reads it through |
| --------------------- | ---------------------------------------------- | -------------------------------------------- | ---------------------- |
| Repo instructions     | `AGENTS.md`                                    | `AGENTS.md` directly (no `CLAUDE.md`)        | `AGENTS.md` directly   |
| Project hooks         | `.agents/hooks/*.sh`                           | the `hooks` block of `.claude/settings.json` | `.codex/hooks.json`    |
| Tools on PATH         | `.agents/required-tools`                       | the shared `check-tool-path` hook            | the same hook          |
| Permissions, launcher | `.claude/settings.json`, `.claude/launch.json` | directly                                     | none                   |

- **`AGENTS.md` is the only instructions file.** There is no `CLAUDE.md`: Claude Code reads
  `AGENTS.md` directly while no `CLAUDE.md` sits in the working directory or above it, so adding
  one would silently stop it reading these instructions. Claude-only notes go in
  `~/.claude/CLAUDE.md`.
- **A skill only Rubens uses** goes in `.agents/skills/<name>/`, under a name no shared skill
  has, with `.claude/skills` made a symlink to `.agents/skills` so Claude Code sees it. There is
  none today. A change to a shared skill is a PR to `leomontigatti/agent-workflow`.
- **A hook change is a change to the script.** Adding or removing a project hook touches both
  wiring files, which carry the same events and matchers. The scripts read either payload:
  Claude Code's `tool_input.file_path`, or a Codex patch in `tool_input.command`.
- **Codex reads `.codex/` from the main checkout**, even in a worktree, so a new hook reaches a
  worktree only once it is on the branch the main checkout has out. `AGENTS.md` comes from the
  worktree itself.
- **Codex runs a project hook only once the project is trusted**, and each hook is approved the
  first time Codex offers it.

## Session hooks

Hooks are configuration, so they run in a headless session too. The project's two:

- **`PostToolUse` on `Write|Edit`**: `format-edited-file.sh` runs `vp fmt` on each file the
  tool just wrote, silently, for the extensions Oxfmt formats.
- **`Stop`**: `stop-typecheck-lint.sh` runs `vp check --no-fmt` (lint and type check), and
  **blocks** with exit 2 while it is red, putting the failing output in front of the agent. It
  runs only when the working tree has a TypeScript or JavaScript file or a `package.json` or
  `tsconfig` change, and it reads the uncommitted tree, so it also reports failures in files the
  turn did not touch.

`SKIP_STOP_CHECKS` set to any value is the local bypass. The `Stop` gate keeps blocking while
the failure persists; Claude Code force-closes the turn after 8 consecutive blocks.

The shared hooks, wired at user level, add a `SessionStart` warning when a tool in the shared
list or in `.agents/required-tools` is missing from PATH, and refuse `pkill -f`, whose pattern
matches the agent's own Bash call; `pnpm dev:stop` stops this worktree's dev server instead.

## The agent shell's PATH

T3 Code, and the Claude Code and Codex sessions it starts, inherit PATH from the desktop login
session. That session reads `~/.profile`, not `~/.bashrc`, so a tool directory added only in
`~/.bashrc` is on PATH in a terminal and missing in an agent's shell. This machine needs fnm's
default Node directory (`node` and `pnpm`) and pnpm's global bin directory (`playwright-cli`)
there, both in `~/.profile`. A change takes effect at the next login.

When the `SessionStart` warning fires, the fix is that profile line, made by the user. A session
does not prefix its commands with `export PATH=…`: that hides the cause from the next session.

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
