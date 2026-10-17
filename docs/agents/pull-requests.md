# Pull requests

What Rubens adds to the shared `pr` and `babysit-pr` skills, which hold the body template, the
title rule, the one-way doors, stacking and the babysit loop.

PRs are squash-merged, so the title becomes the commit subject. Title, subject and body are
English. Check a title with `pnpm check:pr-title "<title>"` before `gh pr create`; CI runs the
same check (`pr-title`) on every PR.

## Base branch

- A PR targets `main`, unless it is a layer of a stack (the `pr` skill's § Stacked PRs).
- Branch protection on `main` requires the `checks`, `actions-gate` and `pr-title` contexts
  ([ci.md](../operations/ci.md#required-contexts)), and a branch current with `main`. The babysit
  updates it once, when being behind is all that is left.

## PRD PRs

One PR carries every sub-issue of a PRD. Its body lists each sub-issue as a checkbox with its own
closing keyword (`- [ ] Closes #N <title>`), so that GitHub closes the sub-issue on merge. The PR
is a **draft** until the chain has landed and been reviewed. The session ticks each box when its
slice lands on the branch, so the body is the progress record.
