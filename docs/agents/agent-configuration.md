# Agent configuration

How Claude Code and Codex share this repo's instructions, skills, hooks and
subagents, and how a session delegates.

## One copy, two harnesses

Both harnesses read one copy of everything. Only the wiring that a harness reads
from its own directory is kept per harness, and none of those files holds
instructions of its own.

| What                   | The one copy                    | Claude Code reads it through                                          | Codex reads it through                                      |
| ---------------------- | ------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Repo instructions      | `AGENTS.md`                     | `AGENTS.md` directly, since there is no `CLAUDE.md`                   | `AGENTS.md` directly                                        |
| Skills                 | `.agents/skills/<name>/`        | `.claude/skills`, a symlink to `.agents/skills`                       | `.agents/skills` directly                                   |
| Hooks                  | `.agents/hooks/*.sh`            | the `hooks` block of `.claude/settings.json`                          | `.codex/hooks.json`                                         |
| `research` subagent    | `.agents/agents/research.md`    | in T3, a `delegate_task` child; outside, `.claude/agents/research.md` | `.codex/agents/research.toml` (model)                       |
| `reviewer` subagent    | `.agents/agents/reviewer.md`    | in T3, `delegate_task` children; outside, `reviewer-opus`             | `.codex/agents/reviewer.toml`, `reviewer-luna.toml` (model) |
| `implementer` subagent | `.agents/agents/implementer.md` | `.claude/agents/implementer.md`, pinned to Opus                       | `.codex/agents/implementer.toml` (model)                    |
| `reviewer-opus`        | `.agents/agents/reviewer.md`    | `.claude/agents/reviewer-opus.md`, on Opus, read-only                 | none: Codex uses `reviewer`                                 |

- **`AGENTS.md` is the only instructions file.** There is no `CLAUDE.md`: Claude
  Code reads `AGENTS.md` directly while no `CLAUDE.md` sits in the working
  directory or above it, so adding one would silently stop it reading these
  instructions. Claude-only notes go in `~/.claude/CLAUDE.md`.
- **Skills are the one symlink.** Claude Code reads skills only from
  `.claude/skills`, so that path points at `.agents/skills`. A new skill goes in
  `.agents/skills/<name>/` and both harnesses see it.
- **A hook change is a change to the script.** Adding or removing a hook touches
  both wiring files, which carry the same events and matchers. The scripts read
  either payload: Claude Code's `tool_input.file_path`, or a Codex patch in
  `tool_input.command`.
- **`implementer` runs on its harness's own model.** Claude Code's wrapper pins
  Opus, since a subagent left to the default may run on a smaller model.
- **The review roles and research run on Codex models whichever harness
  orchestrates.** Which model and effort each role takes is in "Spawning a
  reviewer" in the [`code-review` skill](../../.agents/skills/code-review/SKILL.md),
  and for research in [Delegating to subagents](#delegating-to-subagents). The `.toml`
  wrappers repeat the model, because Codex reads it nowhere else.
- **The correctness axis runs on Opus** under Claude Code, through `reviewer-opus`,
  so the axis that hunts for bugs is a second model family. Codex cannot run Opus,
  so under Codex that axis is spawned as `reviewer`.
- **Codex reads `.codex/` from the main checkout**, even in a worktree, so a new
  agent or hook reaches a worktree only once it is on the branch the main
  checkout has out. `AGENTS.md` and the skills come from the worktree itself.
- **Codex runs a project hook only once the project is trusted**, and each hook
  is approved the first time Codex offers it.
- **Harness-only files stay where they are.** The permission allowlist in
  `.claude/settings.json` and the dev-server launcher in `.claude/launch.json`
  have no Codex counterpart.

## Session hooks

Hooks are configuration, so they run in a headless session too.

- **`SessionStart`**: `check-tool-path.sh` adds a warning to the session's context
  when its shell cannot find `node`, `pnpm` or `playwright-cli`, pointing at
  [the agent shell's PATH](#the-agent-shells-path). It never edits PATH itself.
- **`PreToolUse` on Bash**: `block-pkill-f.sh` refuses `pkill -f`. Its pattern
  matches the shell running the agent's own Bash call, which then dies with exit 144. The message names `pnpm dev:stop`, which finds the dev server by port and
  working directory.
- **`PostToolUse` on `Write|Edit`**: `format-edited-file.sh` runs `vp fmt` on each
  file the tool just wrote, silently, for the extensions Oxfmt formats.
- **`Stop`**: `stop-typecheck-lint.sh` runs `vp check --no-fmt` (lint and type
  check), and **blocks** with exit 2 while it
  is red, putting the failing output in front of the agent. It runs only when the
  working tree has a TypeScript or JavaScript file or a `package.json` or
  `tsconfig` change, and it reads the uncommitted tree, so it also reports
  failures in files the turn did not touch.

`SKIP_STOP_CHECKS` set to any value is the local bypass. The `Stop` gate keeps
blocking while the failure persists; Claude Code force-closes the turn after 8
consecutive blocks.

## The agent shell's PATH

T3 Code, and the Claude Code and Codex sessions it starts, inherit PATH from the
desktop login session. That session reads `~/.profile`, not `~/.bashrc`, so a tool
directory added only in `~/.bashrc` is on PATH in a terminal and missing in an
agent's shell. This machine needs fnm's default Node directory (`node` and `pnpm`)
and pnpm's global bin directory (`playwright-cli`) there, both in `~/.profile`. A
change takes effect at the next login.

When the `SessionStart` warning fires, the fix is that profile line, made by the
user. A session does not prefix its commands with `export PATH=…`: that hides the
cause from the next session.

## Delegating to subagents

A subagent costs a full orientation and returns only its summary, so delegate by
the size of the read, not the size of the task:

- Reading one to three files to decide or verify something is inline work.
- Understanding that needs four or more files is one narrow mapping subagent,
  which returns the conclusion, not the file dumps.
- Bulk output (a long diff, a log, a rendered page) goes to a subagent when only
  its conclusion is needed in the main thread.
- Bash for state (`git`, `gh`) stays inline.

Brief a subagent with the exact paths to read, never a digest of them, and ask for
its report as text in a fixed shape. A subagent whose last action is a tool call
returns the tool result instead of its report.

Reading outside the repo goes to the `research` agent
([`.agents/agents/research.md`](../../.agents/agents/research.md)). Under Codex it
is the `research` agent on gpt-6-luna at medium effort; in a T3 thread the session
reaches the same model through `delegate_task`, as "Spawning a reviewer" describes;
outside T3, from Claude Code, it is the `research` agent, which runs on Sonnet.
