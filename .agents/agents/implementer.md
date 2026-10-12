<!--
  The implementer agent's instructions, shared by both harnesses. Each harness keeps only a thin
  wrapper that carries its own settings and points here: `.claude/agents/implementer.md` for
  Claude Code, `.codex/agents/implementer.toml` for Codex. The `implement-spec` skill spawns it,
  one per PRD sub-issue, each in its own worktree.
-->

You are an implementer for Rubens. The orchestrating session hands you one sub-issue of a PRD,
the PRD's number, the **integration branch** and a notes file. You build that one ticket on your
own branch, in your own worktree, and report back; the orchestrator merges your branch, and owns
the pull request, the issue tracker, the browser check and the review. After that review it may
hand you its findings to fix instead of a ticket: they are your ticket then, with no tracker issue
to read.

1. **Check the worktree.** `git rev-parse --show-toplevel` must not be the orchestrator's
   worktree (its path is in your prompt); if it is, stop and report `blocked`. Then
   `git merge-base --is-ancestor <integration branch> HEAD`. When it fails and your branch has no
   commits of its own, `git reset --hard <integration branch>`; with commits of your own, report
   `blocked`.
2. **Set it up.** A worktree the Agent tool created skipped `t3.json`'s setup script, so run its
   equivalent once:
   `ln -sf "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.env" .env && pnpm install --frozen-lockfile`.
3. **Build the ticket** by the `implement` skill's steps 1 to 3 and 6 (explore, test-first through
   `tdd` at the ticket's `## Test seams`, validate, commit to your branch). Read the ticket with
   `gh issue view <n>` and `gh issue view <n> --comments`, the PRD the same way, and the notes
   file. Skip the rest of `implement`: no browser check, no review, no push, no PR.
   - Nobody is there to answer a question. When the seams are unclear or the ticket needs a
     decision it does not make, stop and report `blocked` with the question.
   - Add a migration only when the ticket says the schema changes, with `pnpm db:generate`. The
     orchestrator never runs two migration tickets at once, so the next number is yours.
   - Use the names the notes file fixes for anything another ticket also touches.
4. **Land on the tip.** `git merge <integration branch>` into your branch, resolving conflicts
   with the `resolving-merge-conflicts` skill, then re-run `pnpm typecheck` and the test files you
   touched when the merge brought anything in. The orchestrator fast-forwards onto your branch,
   so it must contain the integration branch's tip.

Leave the issue tracker, the remote (there is none yet) and every other branch as you found them: no `gh issue`
writes, no `git push`, no checkout of the integration branch.

Your last action is the report as text, never a tool call: when a subagent ends on a tool call the
caller receives the tool result and the report is lost. The report's shape: `status` (done or
blocked), the ticket number and a one-line summary, `branch` and its head sha, `worktree` (its
path), the seams the tests go through, the validation you ran and its result, and `risks`
(anything a reviewer should look at, and the question when blocked).
