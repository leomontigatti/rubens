# Workflows

How work flows in a local session here: where it starts, what a recommendation
needs behind it, and when a doc changes. The rules for branches, worktrees, PRs and
investigating before editing are the shared `implement` skill's `THREADS.md`; how a
rendered change is checked is [verification.md](./verification.md).

## Where work starts

Implementation happens in a local T3 Code session. A session has a browser, the
dev database and a human to ask. Three entry points, by how much is still unknown:

- **Small and clear** (a bug, a UI tweak, a one-slice feature): say it in the
  thread, or write an issue with what to build and its acceptance criteria. A
  session runs the `implement` skill.
- **Clear but big** (known shape, several slices): `/grilling` until the shape and
  the test seams are agreed, `/to-spec` to file the PRD, `/to-tickets` to slice it
  into sub-issues, then `/implement-spec <PRD>`. The session runs every unblocked
  sub-issue at once in `implementer` subagents, merges each onto the thread's
  branch, and opens one draft PR for the chain. Details in
  [issue-tracker.md](./issue-tracker.md#prd-workflow).
- **Foggy** (decisions nobody has made yet): `/wayfinder`. The map's tickets are
  grilling, research, prototype or task. The map ends with one or more PRDs.

A request names the finish line and the allowed stops, so the session knows when
it is done and when to ask:

```
Implement #12, open the PR and babysit it.
Done means: the acceptance criteria pass, a regression test names the bug, and the
PR is ready to merge. Stop only if the seams are unclear.
```

## Investigate before recommending

- **A recommendation that discards an option is a claim about that option.**
  Research the option you rule out as thoroughly as the one you argue for.
- **Mark claims as verified or inferred.** A statement about how the system
  behaves needs a `file:line` behind it. If there is none, say so.
- **The docs are not evidence about the code.** When a doc and the code disagree,
  the code is what the system does. Report the divergence.

## Worktrees here

Beyond `THREADS.md`: the `t3.json` setup script links `.env` from the main checkout
and installs dependencies before the agent starts, and does nothing in the main
checkout. A worktree's own database and dev port come on its first `pnpm dev` or
`pnpm db:migrate` ([local-development.md](../operations/local-development.md#one-database-per-worktree));
the `housekeeping` skill sweeps the databases of removed worktrees
([housekeeping.md](./housekeeping.md)).

## Documentation

Most code changes need no documentation change: agents and maintainers read the
code. Before adding a paragraph under `docs/`, ask what a later session would get
wrong without it. If the code answers the question, leave it out.

- `docs/agents/` holds operative rules and traps that are hard to find in the
  source. `docs/domain/` holds the domain rules. `docs/adr/` holds decisions and
  their reasons. `docs/operations/` holds runbooks.
- Do not enumerate fields or functions, narrate control flow, keep file catalogues
  or append PR summaries. Types, tests and code already record them.
- When a documented rule changes, rewrite the affected text. Do not append a second
  account next to it. ADRs are records: a change is a dated amendment, and a
  reversal is a new ADR that supersedes the old one.
- A session's plan and scratch notes stay out of the repo. The issue and the PR are
  the record of the work.
