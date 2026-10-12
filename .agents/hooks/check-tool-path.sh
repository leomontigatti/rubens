#!/usr/bin/env bash
#
# SessionStart hook, wired from both `.claude/settings.json` and
# `.codex/hooks.json`. Both harnesses add a SessionStart hook's
# `hookSpecificOutput.additionalContext` to the session's context.
#
# Warns at the start of a session whose shell cannot find node, pnpm or
# playwright-cli. Agents used to work around that with
# `export PATH=~/.local/share/pnpm/bin:$PATH` in front of every command,
# when the cause is one line in the user's login profile: the harness inherits
# PATH from the desktop session, which reads `~/.profile`, not `~/.bashrc`.
# It only reports: it never edits PATH, so the fix stays at the source.
#
# See docs/agents/agent-configuration.md#the-agent-shells-path.

set -uo pipefail

missing=()
for tool in node pnpm playwright-cli; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done

if [ "${#missing[@]}" -eq 0 ]; then
  exit 0
fi

message="This session's shell cannot find ${missing[*]} on PATH. The harness inherits PATH from the desktop login session, so a tool directory added only in ~/.bashrc is missing here. Do not prefix commands with \`export PATH=…\`: tell the user, who fixes it at the source as docs/agents/agent-configuration.md#the-agent-shells-path says. Without playwright-cli, stop before UI verification instead of using a harness's built-in browser."

# Printed without jq, so the warning needs nothing but bash. The message holds
# no double quote or backslash, the two characters JSON would need escaped.
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$message"
