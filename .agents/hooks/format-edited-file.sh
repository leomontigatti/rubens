#!/usr/bin/env bash
#
# PostToolUse hook (matcher: Write|Edit), wired from both `.claude/settings.json`
# and `.codex/hooks.json`.
#
# Formats the files the tool just wrote with Oxfmt, through `vp fmt`, so
# formatting stops being anyone's job. `vp fmt` takes file arguments, and
# `--no-error-on-unmatched-pattern` makes a file it does not format a silent
# no-op rather than an error.
#
# The two harnesses describe the edit differently. Claude Code's `Write`/`Edit`
# send `tool_input.file_path`. Codex matches `Write|Edit` against `apply_patch`,
# whose `tool_input.command` is the patch itself; its `*** Add File:`,
# `*** Update File:` and `*** Move to:` headers name the files, relative to the
# payload's `cwd`.
#
# Three things about this hook are deliberate:
#
# - It calls the local `vp` binary directly instead of `pnpm exec vp`: pnpm's
#   own startup is a visible share of a call that fires after every edit.
# - It always exits 0 and never writes to stderr. PostToolUse stderr is fed back
#   to the agent, and a reformat is not something the agent should react to.
# - Only the extensions Oxfmt formats are passed in. Anything else, a shell
#   script or an image, is skipped without starting `vp` at all.
#
# See docs/agents/agent-configuration.md.

set -uo pipefail

input="$(cat)"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)"

# One path per line: Claude Code's `file_path`, or the file headers of a Codex
# patch. A deleted file has nothing to format, so `*** Delete File:` is skipped.
files="$(
  printf '%s' "$input" | jq -r '
    .tool_input.file_path // empty,
    (.tool_input.command // "" | strings
      | split("\n")[]
      | capture("^\\*\\*\\* (Add File|Update File|Move to): (?<path>.+)$")?
      | .path)
  ' 2>/dev/null
)"

[ -n "$files" ] || exit 0

project_dir="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
vp="$project_dir/node_modules/.bin/vp"
[ -x "$vp" ] || exit 0

while IFS= read -r file; do
  case "$file" in
    /*) ;;
    *) [ -n "$cwd" ] && file="$cwd/$file" ;;
  esac
  [ -f "$file" ] || continue

  case "$file" in
    *.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc | *.md | *.mdx | *.yml | *.yaml | *.css | *.html) ;;
    *) continue ;;
  esac

  # Output is dropped; the exit code is never the hook's.
  "$vp" fmt --write --no-error-on-unmatched-pattern "$file" >/dev/null 2>&1
done <<<"$files"

exit 0
