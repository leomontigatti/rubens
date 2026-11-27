#!/usr/bin/env -S python3 -I
#
# PreToolUse hook (matcher: Bash), wired from both `.claude/settings.json` and
# `.codex/hooks.json`; both harnesses send the command as `tool_input.command`.
#
# Refuses the ways an agent's shell skips the pre-commit hook (`.vite-hooks/pre-commit`):
# `--no-verify` on any git command, `git commit -n` (alone or in a cluster such as `-nm`),
# `core.hooksPath` set or read through git, and `HUSKY`, `VP_GIT_HOOKS` or `VITE_GIT_HOOKS`
# set to exactly `0`, which the hook runner in `.vite-hooks/_/h` reads as "skip".
#
# The command is split the way the shell would, quotes and comments included, so a commit
# message that only names a flag passes. A command it cannot split (an unclosed quote) passes
# too: the shell would refuse it anyway.
#
# It stops an agent in Claude Code or Codex, not a person in a terminal or a Capy thread,
# which runs no harness hooks; CI runs the same checks on every pull request for everyone.

import json
import os
import re
import shlex
import sys

OFF_SWITCHES = {"HUSKY", "VP_GIT_HOOKS", "VITE_GIT_HOOKS"}
WRAPPERS = {"sudo", "env", "command", "exec", "time", "nice", "nohup"}
WRAPPER_FLAGS_WITH_VALUE = {"-u", "-g", "-n", "-C", "-h", "-p", "-U", "-S", "--user", "--group"}
GIT_OPTIONS_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"}
ASSIGNMENT = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.DOTALL)
NO_VERIFY_CLUSTER = re.compile(r"^-[asqvpz]*n[a-zA-Z]*$")
HOOKS_PATH = re.compile(r"^(-c|--config-env=)?core\.hookspath(=|$)", re.IGNORECASE)


def simple_commands(command):
    lexer = shlex.shlex(command, posix=True, punctuation_chars=";&|()<>\n")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    words = []
    for token in lexer:
        if token and set(token) <= set(";&|()<>\n"):
            if words:
                yield words
            words = []
        else:
            words.append(token)
    if words:
        yield words


def refusal(words):
    index = 0
    while index < len(words):
        assignment = ASSIGNMENT.match(words[index])
        if assignment:
            if assignment.group(1) in OFF_SWITCHES and assignment.group(2) == "0":
                return "a hook runner's off switch"
            index += 1
        elif words[index] == "export":
            index += 1
        elif words[index] in WRAPPERS:
            index += 1
            while index < len(words) and words[index].startswith("-"):
                index += 2 if words[index] in WRAPPER_FLAGS_WITH_VALUE else 1
        else:
            break
    if index >= len(words) or os.path.basename(words[index]) != "git":
        return None
    args = words[index + 1 :]
    if "--no-verify" in args:
        return "--no-verify"
    if any(HOOKS_PATH.match(arg) for arg in args):
        return "core.hooksPath"
    position = 0
    while position < len(args) and args[position].startswith("-"):
        position += 2 if args[position] in GIT_OPTIONS_WITH_VALUE else 1
    if position < len(args) and args[position] == "commit":
        if any(NO_VERIFY_CLUSTER.match(arg) for arg in args[position + 1 :]):
            return "git commit -n"
    return None


def main():
    command = json.load(sys.stdin).get("tool_input", {}).get("command") or ""
    try:
        commands = list(simple_commands(command))
    except ValueError:
        return 0
    for words in commands:
        reason = refusal(words)
        if reason:
            print(
                f"Do not skip the pre-commit hook ({reason}). Fix what it reports and commit"
                " again; on a machine too small for it, move to a larger one"
                " (docs/agents/validation.md § Before committing).",
                file=sys.stderr,
            )
            return 2
    return 0


sys.exit(main())
