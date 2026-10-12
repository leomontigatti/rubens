---
name: implement-spec
description: "Implement a PRD's sub-issues in parallel: background implementer subagents, one worktree per ticket, merged onto this thread's branch and one draft PR, reviewed once at the end."
disable-model-invocation: true
---

<!--
  Local adaptation of `implement-spec` in mattpocock/skills
  (skills/engineering/implement-spec/SKILL.md, graduated 2026-09-24). It keeps upstream's task
  graph, frontier and integration branch, and swaps in this repo's pieces: the `implementer` agent running `implement`, migrations serialised, the
  browser check and the tiered review once at the end, then `babysit-pr`.
-->

# Implement a spec

The argument is a PRD issue number whose sub-issues `/to-tickets` filed. The goal is every
sub-issue built, merged onto this thread's branch, which is the **integration branch**, and one
PR that closes the chain, reviewed and babysat once.

The sub-issues are a **task graph**, not a list: their blocking edges decide what can start, and
the **frontier** is every open ticket whose blockers have all merged onto the integration branch.
Every ticket on the frontier runs at once, each in an `implementer` subagent with its own
worktree. Talk to the implementers through pointers (the ticket, the PRD, the notes file, a
commit), never pasted summaries.

## 1. Read the graph

Start current, as `implement` step 1 says. Read the PRD with `gh issue view <PRD>` and
`--comments`, list its sub-issues with `gh issue view <PRD> --json subIssues`, and read each one
with `--json number,title,body,state,blockedBy`. A resumed run reads the PR body's
`## Sub-issues` checkboxes and the `Implemented in <sha>` comments to learn what already merged.

Two edges the tracker does not hold, added by you:

- **Migrations run one at a time.** Two tickets that each add a migration would take the same
  number and fork drizzle's journal and snapshot chain, so treat every pair of migration tickets
  as blocked one on the other, in list order. A ticket whose text does not settle whether it
  touches the schema counts as one.
- **Shared names are fixed up front.** Worktrees postpone collisions to the merge. When two
  frontier tickets add to the same file, type, route or copy, either serialise them or fix the
  exact names in the notes file before spawning them.

Write the graph, those decisions and the names to `/tmp/implement-spec-<PRD>/notes.md`, outside
the repo, where every implementer can read it. Done when every ticket has its blockers listed.

If the PRD alters a rendered screen, capture its **before** screenshots now, from this worktree,
following `implement` step 4.

## 2. Run the frontier

Spawn one Agent per frontier ticket, all in one message: `subagent_type: "implementer"`,
`isolation: "worktree"`, `run_in_background: true`. These worktrees are the one exception to
"never create a worktree of your own" in
[workflows.md](../../../docs/agents/workflows.md#branches-worktrees-and-t3-code-threads): the PR
stays on this thread's worktree. The prompt is pointers only:

```
Ticket #<n>, part of PRD #<PRD>. Integration branch: <branch>.
Orchestrator worktree (not yours): <this worktree's path>.
Notes: /tmp/implement-spec-<PRD>/notes.md
```

Then end your turn; each implementer re-invokes you when it reports.

## 3. Merge each report

For each report with `status: done`:

1. Check the branch builds on the tip: `git merge --ff-only <its branch>` in this worktree. When
   it is not a fast-forward (another ticket merged meanwhile), send it back with SendMessage to
   merge the tip again, and move on.
2. Comment `Implemented in <sha>. Part of #<PRD>.` on the sub-issue, which stays open
   ([issue-tracker.md](../../../docs/agents/issue-tracker.md)).
3. Push. After the first merge, open the PR as a **draft** with the PRD PR body of the `pr` skill
   ([PRD PRs](../../../docs/agents/pull-requests.md#prd-prs)) and link it to the thread; after
   that, tick the sub-issue's box in its body. A draft is not reviewed by CodeRabbit, so the chain
   pays one review instead of one per slice.
4. Remove the implementer's worktree and branch (`git worktree remove <path>`,
   `git branch -d <branch>`).
5. Recompute the frontier from what has merged onto the integration branch, never from GitHub's
   `blockedBy`, which drops only when a blocker closes, at the end. Spawn, as in step 2, only
   the tickets on it that are not already running: keep the merged and running tickets in the
   notes file, so neither starts twice.

A `blocked` report carries a question: answer it from the PRD if it settles it and send it back
with SendMessage; otherwise bring it to the user, and keep the rest of the graph running.

## 4. Close out, once

When every ticket has merged:

1. Run `implement` step 3, the validation list, on the integration branch.
2. Run `implement` step 5's review over the whole chain, once, since the branch point. Paste the
   PRD and every sub-issue into the Spec axis's prompt. Reviewing earlier reads every unbuilt
   ticket as a finding.
3. Send every **fix** to one `implementer`, spawned as in step 2 with the findings in place of
   the ticket number. Land it with step 3's fast-forward, push and worktree removal; there is no
   sub-issue to comment on or tick. Then re-run only the checks the findings named: no second
   broad review.
4. Run `implement` step 4 now that the code is final: the **after** screenshots, added to the PR body.
5. `gh pr ready <n>`, then call the Skill tool with "babysit-pr".
6. Remove any implementer worktree still listed in `git worktree list`, and
   `/tmp/implement-spec-<PRD>/`.
