# Pull requests

How a PR is written here. The body is written with the
[`pr` skill](../../.agents/skills/pr/SKILL.md), which has the template, the rules
and the one-way doors. The title rule is enforced by `pnpm check:pr-title`. Branches
and linking a PR to its T3 thread are in [workflows.md](./workflows.md#branches-worktrees-and-t3-code-threads).

PRs are squash-merged, so the title becomes the commit subject. Title, subject and
body are English.

## PRD PRs

One PR carries every sub-issue of a PRD. Its body lists each sub-issue as a
checkbox with its own closing keyword (`- [ ] Closes #N <title>`), so that GitHub
closes the sub-issue on merge. The PR is a **draft** until the chain has landed and
been reviewed. The session ticks each box when its slice lands on the branch, so the
body is the progress record.

## UI evidence

A PR that changes what a screen looks like carries a before and an after image. A change
to motion or interaction carries a short GIF instead.

- Capture against data the worktree's own database holds, never a copy of production:
  screenshots show names and appointments. The browser loop is in
  [workflows.md](./workflows.md#ui-verification).
- `gh` cannot attach files to a PR. Drag the images into the PR body on GitHub,
  under `## Evidence`, labelled Before and After.
- **If the repository is public, every image is public.** Never put a real patient's
  data on screen for a capture.
- Never commit evidence images to the repo.

## Babysitting a PR

Seeing a PR through CI and review is the [`babysit-pr` skill](../../.agents/skills/babysit-pr/SKILL.md).
The session that opened the PR watches its checks, fixes what holds, answers the
rest with a reason, and stops at ready to merge. The merge is the user's, or the
launching thread's when the user hands it over
([workflows.md](./workflows.md#branches-worktrees-and-t3-code-threads)).

Branch protection requires a branch current with `main`. The babysit updates it
once, when being behind is all that is left.

CodeRabbit is optional. If it reviews a PR, its findings are checked against the
source like any other finding: it has the diff and the standards, not the issue or
the domain. The in-session review (the correctness axis of `implement`'s review)
does not depend on it.
