#!/usr/bin/env bash
#
# Stop hook, blocking. Wired from both `.claude/settings.json` and
# `.codex/hooks.json`.
#
# A turn may not end on a red lint, typecheck or fallow gate. Two gates run, in
# this order:
#
# - `pnpm exec vp check --no-fmt`: Oxlint (type-aware) and the TypeScript check
#   in one pass, about 1.7 s measured on this repo. Formatting is not in it,
#   because the PostToolUse hook already formats every file the agent writes.
# - `pnpm check:fallow`: dead code, complexity and duplication this branch adds
#   against `origin/main`, about a second. Without it a batch of components over
#   the complexity limit surfaces only at commit. Read by exit code
#   (docs/agents/fallow.md): 1 is the branch's findings, 2 is "could not run",
#   and both block.
#
# Tests are not in it; they are the agent's to run for what it touched
# (docs/agents/validation.md).
#
# It exits early on the paths where it buys nothing:
#
# - `SKIP_STOP_CHECKS` set: the documented local bypass.
# - Running inside a GitHub Actions workflow: CI runs its own checks.
# - No changed path, tracked or untracked, that the gates could read:
#   `.ts`/`.tsx`/`.mts`/`.cts`, `.js`/`.jsx`/`.mjs`/`.cjs`, `tsconfig*.json` and
#   `package.json`. `vite.config.ts` holds the lint configuration and is covered
#   by the `.ts` rule. Changes to docs or agent files alone skip the gates.
#
# Before the gates, it blocks with one line when the dependencies are older than
# `pnpm-lock.yaml` (or `node_modules` is missing): a lint run against stale
# packages fails on imports, and that output reads as a code problem. The
# reference is the newer of `node_modules/.modules.yaml` and
# `node_modules/.pnpm-workspace-state-v1.json`, because pnpm rewrites only the
# second on an install that finds nothing to do, and a lockfile touched without
# a content change (a checkout back and forth) must not block forever.
#
# The filter reads the working tree only. Committed work already passed the Vite+
# pre-commit hook, which runs the same checks (`.vite-hooks/pre-commit`), so this
# hook owns the uncommitted remainder of a turn.
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
# Every other failure is fail-open on purpose: this hook blocks the end of a
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

# `-nt` is true when the right-hand file is missing, which covers a missing
# `node_modules` too.
installed="node_modules/.modules.yaml"
if [ node_modules/.pnpm-workspace-state-v1.json -nt "$installed" ]; then
  installed="node_modules/.pnpm-workspace-state-v1.json"
fi
if [ -f pnpm-lock.yaml ] && [ pnpm-lock.yaml -nt "$installed" ]; then
  echo "dependencies are older than pnpm-lock.yaml: run \`pnpm install --frozen-lockfile\`" >&2
  exit 2
fi

vp="./node_modules/.bin/vp"
[ -x "$vp" ] || exit 0

output=""
if ! lint_output="$("$vp" check --no-fmt 2>&1)"; then
  output="$lint_output"
fi

if command -v pnpm >/dev/null 2>&1; then
  fallow_output="$(pnpm --silent check:fallow 2>&1)"
  case $? in
    0) ;;
    2) output="${output:+$output

}fallow could not run, so this branch was never checked; run \`git fetch origin\` and retry (docs/agents/fallow.md):
$fallow_output" ;;
    *) output="${output:+$output

}$fallow_output" ;;
  esac
fi

if [ -z "$output" ]; then
  exit 0
fi

if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ]; then
  instruction="If you cannot fix this, say so explicitly and report the work as blocked."
else
  instruction="Fix this before ending the turn."
fi

printf '%s\n\n%s\n' "$output" "$instruction" >&2
exit 2
