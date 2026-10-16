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

## Evidence

Before and after images, and where they go: [verification.md](./verification.md#evidence).

## Blast radius

What a wrong change breaks here, to name in the body's **Blast Radius**: the agenda of every
office, the booking form, the reminder queue, one organization's data seen by another.

## Review bot

CodeRabbit, configured in `.coderabbit.yaml`; its login starts with `coderabbitai`.

- **When to ask**: never by default. It reviews every non-draft PR into `main` on its own
  (`auto_review`), with the diff, the ADRs and `AGENTS.md` as its knowledge base. Ask with a
  `@coderabbitai review` comment (through `--body-file`) only when a PR left draft got no review,
  or a push cancelled one.
- **How to read it**: its findings are in review threads and in the review body (outside-diff
  comments, nitpicks). It has the diff and the standards, not the issue or the domain, so each
  claim is checked against the source. `review_status` is off, so a skipped review may post
  nothing: no reply after the checks finish is a skip, reported as such.
- **Optional.** It has not reviewed any PR yet (#1 to #5). A rate limit, a skip or silence is
  reported and the PR goes ahead; the in-session review does not depend on it.
