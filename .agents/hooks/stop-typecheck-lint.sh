#!/usr/bin/env bash
#
# Stop hook, blocking. Wired from both `.claude/settings.json` and
# `.codex/hooks.json`.
#
# A turn may not end on a red lint or typecheck. The gate is
# `pnpm exec vp check --no-fmt`: Oxlint (type-aware) and the TypeScript check in
# one pass, about 1.7 s measured on this repo. Formatting is not in it, because
# the PostToolUse hook already formats every file the agent writes. Tests are
# not in it either; they are the agent's to run for what it touched
# (docs/agents/validation.md).
#
# It exits early on the paths where it buys nothing:
#
# - `SKIP_STOP_CHECKS` set: the documented local bypass.
# - Running inside a GitHub Actions workflow: CI runs its own checks.
# - No changed path, tracked or untracked, that the gate could read:
#   `.ts`/`.tsx`/`.mts`/`.cts`, `.js`/`.jsx`/`.mjs`/`.cjs`, `tsconfig*.json` and
#   `package.json`. `vite.config.ts` holds the lint configuration and is covered
#   by the `.ts` rule. Changes to docs or agent files alone skip the gate.
#
# The filter reads the working tree only. Committed work already passed the Vite+
# pre-commit hook, which runs the same check (`.vite-hooks/pre-commit`), so this
# gate owns the uncommitted remainder of a turn.
#
# On failure it exits 2 with the failing output on stderr, which both harnesses
# feed back to the agent: Claude Code as the block reason, Codex as a
# continuation prompt. It keeps blocking while the failure persists; Claude Code
# force-closes the turn after 8 consecutive blocks, and that is the backstop,
# which is why `stop_hook_active` only picks the trailing instruction.
#
# There is no `SubagentStop` hook: it is a distinct event, and `research`,
# `Explore` and `Plan` do not author app code.
#
# Every failure below is fail-open on purpose: this hook blocks the end of a
# turn, so a broken project dir or a non-repo checkout must not wedge the
# session. That is also why `set -e` is absent.
#
# See docs/agents/agent-configuration.md.

set -uo pipefail

input="$(cat)"

if [ -n "${SKIP_STOP_CHECKS:-}" ]; then
  exit 0
fi

if [ -n "${GITHUB_WORKFLOW:-}" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" || exit 0

# `--untracked-files=all` because the default collapses an untracked directory to
# its parent, which hides every extension under it. `-z` so paths arrive unquoted
# and a rename's two paths arrive as two entries; the status prefix in front of
# each is harmless to a suffix match.
changed_status_lines="$(git status --porcelain --untracked-files=all -z 2>/dev/null | tr '\0' '\n')"
if ! printf '%s\n' "$changed_status_lines" | grep -Eq '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$|(^|/| )tsconfig[^/]*\.json$|(^|/| )package\.json$'; then
  exit 0
fi

vp="./node_modules/.bin/vp"
[ -x "$vp" ] || exit 0

if output="$("$vp" check --no-fmt 2>&1)"; then
  exit 0
fi

if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ]; then
  instruction="If you cannot fix this, say so explicitly and report the work as blocked."
else
  instruction="Fix this before ending the turn."
fi

printf '%s\n\n%s\n' "$output" "$instruction" >&2
exit 2
