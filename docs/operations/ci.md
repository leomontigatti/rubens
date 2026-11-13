# Continuous integration

What gates a PR to `main`, what each gate runs, and how the pins behind it are
bumped. Each job's reasoning lives in the comments of its workflow file; this page
is the index.

## Required contexts

Four contexts should be required on `main` in branch protection. Required contexts
are a repo setting, not a file here: renaming or adding a job does not update
protection, so changing the list is a human step in the repo settings.

- `checks` (`ci.yml`): secrets scan over the PR's commits, `pnpm check`,
  `pnpm check:labels`, `pnpm check:comment-language`, `pnpm check:file-tokens`,
  `pnpm check:dependency-audit`, `pnpm check:fallow`, `pnpm check:dupes`, `pnpm test:unit`, `pnpm test:workers`
  and `pnpm build`. No database service: `test:workers` runs the organization object in
  Miniflare.
- `actions-gate` (`ci.yml`): zizmor and actionlint over `.github/workflows/`, and zizmor
  over `.github/dependabot.yml`.
- `pr-title` (`pr-title.yml`): the `check:pr-title` script over the PR title, under
  plain Node with no install. It lives in its own file because it needs the `edited`
  event, which fires on a body edit too; it runs then as well, since a skipped job
  would report the context as success over a failed title.
- `review-record` (`review-record.yml`): the shared `review-record` action from
  `leomontigatti/agent-workflow` over the PR body's `## Review` record. It fails a
  record missing a reviewer the diff's tier needs (the tier comes from the
  `review-paths` block of [review.md](../agents/review.md)) and a code commit pushed
  after the reviewed one. Dependabot's PRs pass without one; a draft is skipped
  until it is marked ready. Its own file for the same `edited` reason as `pr-title`.

Not required yet:

- `e2e` (`ci.yml`): `pnpm test:e2e`, the browser suite, on every PR in parallel with
  `checks`. Make it a required context after about two weeks of PRs without a flaky
  run, counted from the PR that added it; a failure that a rerun turns green restarts
  the count. Until then a red `e2e` is read, not ignored: a real failure blocks the
  merge like any other.

Also required, in branch protection: direct pushes to `main` forbidden, and
"require branches to be up to date" on, so each required context runs against the
current `main`.

## What `checks` does, in order

1. **Fetch `origin/main`** with full history, once, for every step below that
   compares against it. Never `--depth=1`: fallow needs the merge base.
2. **Classify the diff.** A diff made only of `*.md` files and `docs/` is
   docs-only: steps 9 to 12 skip on it, except `test:unit`, which reads
   `GLOSSARY.md` and the tracked Markdown. The job still reports, so the required
   context passes. An empty diff counts as code, and a rename counts its old path.
   The skip is per step, not a `paths:` filter on the workflow, because a required
   context that never runs stays pending and blocks the merge.
3. **gitleaks** over `origin/main..HEAD` (the PR's own commits). Rules in
   `.gitleaks.toml`. The same scan runs locally as the first line of
   `.vite-hooks/pre-commit`, which warns when the binary is missing; CI is the blocking
   half. gitleaks and GitHub push protection are the secret scans; the GitGuardian app
   was removed on 2026-11-03 because its non-required check duplicated them and
   flagged test literals.
4. **`vp install --frozen-lockfile`** after `voidzero-dev/setup-vp`, which installs
   Node from `.nvmrc` and pnpm from `packageManager`.
5. **`pnpm check`** (`vp check`): format, lint and typecheck.
6. **`pnpm check:labels`**: every label a workflow, script or agent doc names in a
   `--label` flag, a workflow condition or a `priority:`/`wayfinder:` name is in
   `.github/labels.json` ([issue-tracker.md](../agents/issue-tracker.md#labels)).
7. **`pnpm check:comment-language`**: no Spanish engineering prose anywhere in the
   tree ([coding-standards.md](../agents/coding-standards.md#code-language)).
8. **`pnpm check:file-tokens`**: no source file under `src/` above the
   estimated-token ceiling.
9. **`pnpm check:dependency-audit`**: fails only on high and critical advisories this
   branch introduces, compared with `origin/main`.
10. **`pnpm check:fallow`**: dead code, unused dependencies and duplication this
    branch introduces ([fallow.md](../agents/fallow.md)). Exit 2 (fallow could not
    run) fails the job too.
11. **`pnpm check:dupes`**: the whole codebase's duplicated lines against the 3%
    ceiling ([fallow.md](../agents/fallow.md#the-gate)).
12. **`pnpm test:unit`** and **`pnpm test:workers`**.
13. **`pnpm build`**: the production build a deploy ships
    ([infrastructure.md](./infrastructure.md#deploy)).

## What `e2e` does, in order

1. **Fetch `origin/main` and classify the diff**, as `checks` does: on a docs-only
   diff every later step skips and the job still reports.
2. **`vp install --frozen-lockfile`** after `setup-vp`.
3. **Install Chromium**: the headless shell of the pinned `@playwright/test`.
4. **`pnpm test:e2e`**: the production build, the suite's object storage cleared, the
   Worker served by `wrangler dev` with the dev sign-in (no keys, no database service),
   then the specs, two workers, no retries.
5. **On failure, upload `test-results/e2e/`** as the `e2e-traces` artifact: each failed
   spec's trace and screenshots, made-up data only.

How the suite is built and what a spec may assume: [tests/e2e/README.md](../../tests/e2e/README.md).

## Waiting on CI from a session

`gh pr checks <n> --watch` blocks until every check on the PR is terminal and exits
non-zero when one failed. After a force-push, check the run id it reports against
`gh run list --branch <branch>` before reading a cancelled run as red.

## Pins

Every external tool is pinned to an exact version, and every action to a commit SHA
with its tag in a comment. The npm packages are bumped by a weekly T3 scheduled task,
minor and patch within each package's major, with the `vite` and `vitest` overrides
moved beside `vite-plus` and the dependency skills copied again
([dependency-updates.md](../agents/dependency-updates.md)). Dependabot opens weekly
PRs for minor and patch updates of the action pins only (`.github/dependabot.yml`).
A major, of either, stays a hand-written issue.

| Pin                                        | Where                                        | Source of the value                                 |
| ------------------------------------------ | -------------------------------------------- | --------------------------------------------------- |
| `setup-vp`                                 | `ci.yml`, `pr-title.yml` (SHA + `# v1.21.2`) | the release tag's commit, `gh api`                  |
| `actions/checkout`                         | all jobs (SHA + `# v5`)                      | the tag's commit                                    |
| `agent-workflow/actions/review-record`     | `review-record.yml` (SHA + `# v1.1.0`)       | the release tag's commit, `gh api`                  |
| `GITLEAKS_VERSION` + `GITLEAKS_SHA256`     | `ci.yml`, `checks` job                       | `gitleaks_<version>_checksums.txt` on the release   |
| `ACTIONLINT_VERSION` + `ACTIONLINT_SHA256` | `ci.yml`, `actions-gate` job                 | `actionlint_<version>_checksums.txt` on the release |
| `zizmor==<version>`                        | `ci.yml`, `actions-gate` job (`pipx run`)    | the PyPI release                                    |
| `actions/upload-artifact`                  | `ci.yml`, `e2e` job (SHA + `# v7.0.2`)       | the release tag's commit, `gh api`                  |
| `@playwright/test`                         | `package.json` (exact version)               | npm; the Chromium it installs follows it            |
| Node                                       | `.nvmrc` and `engines.node`                  | both must match; see below                          |
| pnpm                                       | `packageManager` in `package.json`           | the pnpm release                                    |

### How to bump

1. Actions: run `pinact run --update` (from `suzuki-shunsuke/pinact`, not a repo
   dependency) over `.github/workflows/`. It rewrites each `uses:` to the newest
   release's SHA with the tag comment. For `setup-vp` specifically, the Vite+ docs
   say to use an exact release, never the `v1` tag.
2. gitleaks, actionlint: change the version and the checksum **together**, taking the
   checksum from the release's `*_checksums.txt`. A checksum that does not match fails
   the job before anything is scanned.
3. zizmor: change `zizmor==<version>` in `ci.yml`.
4. Node: change `.nvmrc` and `engines.node` in `package.json`. Both must name the same
   version.
5. Push, and read the `actions-gate` result: its online audits (`impostor-commit`,
   `ref-version-mismatch`, `known-vulnerable-actions`) are the only check that a
   rewritten pin points at the tag its comment names.

## Running the gates locally

Everything in `checks` is a `pnpm` script, so a session can run it before pushing.
fallow and the audit compare against `origin/main`; fetch it first
(`git fetch origin main`). `actionlint` and `zizmor` are optional locally.

### Installing gitleaks locally

Required on every machine that commits. The pre-commit hook only warns and skips when the
binary is absent, and the repo is public, so CI catches a leak only after it is pushed.
`.agents/required-tools` lists it, so a session without it is warned at its start. Use the
version `GITLEAKS_VERSION` names in `ci.yml`:

```sh
curl -fsSL -o /tmp/gitleaks.tar.gz \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz
tar -xzf /tmp/gitleaks.tar.gz -C /tmp gitleaks && sudo mv /tmp/gitleaks /usr/local/bin/
```
