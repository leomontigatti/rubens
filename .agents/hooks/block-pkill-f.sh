#!/usr/bin/env bash
#
# PreToolUse hook (matcher: Bash), wired from both `.claude/settings.json` and
# `.codex/hooks.json`; both harnesses send the command as `tool_input.command`.
#
# Blocks `pkill -f` and points at `pnpm dev:stop` instead.
#
# `pkill -f <pattern>` matches full command lines, and the shell running the
# agent's own Bash call carries the pattern in its command line, so it kills
# itself and the call dies with exit 144. `pnpm dev:stop` picks the dev server
# by port and working directory instead.
#
# See docs/agents/agent-configuration.md.

set -euo pipefail

input="$(cat)"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"

# `pkill -f`, `-fx` or `--full`, with other flags before it or not, in command
# position: at the start or after `;`, `&`, `|`, `(` or `sudo`. Quoting is not
# parsed, so prose that names it mid-sentence passes, but quoted text with
# `; pkill -f` in it is still blocked; put such a message in a file (`git
# commit -F`).
if printf '%s' "$command" | grep -Eq '(^|[&|;(]|sudo)[[:space:]]*pkill([[:space:]]+-[^[:space:]]+)*[[:space:]]+(-[a-zA-Z]*f[a-zA-Z]*|--full)([[:space:]]|$)'; then
  echo "Do not use 'pkill -f': it matches its own shell's command line and kills the agent's Bash call (exit 144). To stop this worktree's dev server, run 'pnpm dev:stop'; to stop anything else, find the pid with 'lsof' or 'pgrep' and 'kill' it. See docs/agents/agent-configuration.md." >&2
  exit 2
fi

exit 0
