# Continuous integration

What gates a PR to `main`, what each gate runs, and how the pins behind it are
bumped. Each job's reasoning lives in the comments of its workflow file; this page
is the index.

## Required contexts

Three contexts should be required on `main` in branch protection. Required contexts
are a repo setting, not a file here: renaming or adding a job does not update
protection, so changing the list is a human step in the repo settings.

- `checks` (`ci.yml`): secrets scan over the PR's commits, `pnpm check`,
  `pnpm check:labels`, `db:generate` drift check, `pnpm check:migrations`,
  `pnpm check:dependency-audit`, `pnpm test:unit`, `pnpm test:db` and `pnpm build`. No database service: `test:db`
  runs on PGlite.
- `actions-gate` (`ci.yml`): zizmor and actionlint over `.github/workflows/`, and zizmor
  over `.github/dependabot.yml`.
- `pr-title` (`pr-title.yml`): the `check:pr-title` script over the PR title, under
  plain Node with no install. It lives in its own file because it needs the `edited`
  event, which fires on a body edit too; it runs then as well, since a skipped job
  would report the context as success over a failed title.

Also required, in branch protection: direct pushes to `main` forbidden, and
"require branches to be up to date" on, so each required context runs against the
current `main`.

## What `checks` does, in order

1. **Fetch `origin/main`** with full history, once, for every step below that
   compares against it. Never `--depth=1`: fallow needs the merge base.
2. **gitleaks** over `origin/main..HEAD` (the PR's own commits). Rules in
   `.gitleaks.toml`. The same scan runs locally as the first line of
   `.vite-hooks/pre-commit`, where it is optional; CI is the blocking half.
3. **`vp install --frozen-lockfile`** after `voidzero-dev/setup-vp`, which installs
   Node from `.nvmrc` and pnpm from `packageManager`.
4. **`pnpm check`** (`vp check`): format, lint and typecheck.
5. **`pnpm check:labels`**: every label a workflow, script or agent doc names in a
   `--label` flag, a workflow condition or a `priority:`/`wayfinder:` name is in
   `.github/labels.json` ([issue-tracker.md](../agents/issue-tracker.md#labels)).
6. **Drift check**: `pnpm db:generate` is offline and must write nothing new under
   `src/db/migrations`. If it does, the schema changed without its migration. The fix
   is to commit the migration that `db:generate` writes, never to edit a `.sql` file
   already on `main`.
7. **`pnpm check:migrations`** against `origin/main`. Three rules:
   order (a new migration must be newer than every migration on `main`), immutability
   (no applied `.sql` file may change), and safety (squawk over the new `.sql` files).
   Why each one exists: `scripts/migrations/journal.mjs`.
8. **`pnpm check:dependency-audit`**: fails only on high and critical advisories this
   branch introduces, compared with `origin/main`.
9. **`pnpm check:fallow`**: dead code, unused dependencies and duplication this
   branch introduces ([fallow.md](../agents/fallow.md)). Exit 2 (fallow could not
   run) fails the job too.
10. **`pnpm test:unit`** and **`pnpm test:db`**.
11. **`pnpm build`**: the production build the Dockerfile runs.

## Waiting on CI from a session

`gh pr checks <n> --watch` blocks until every check on the PR is terminal and exits
non-zero when one failed. After a force-push, check the run id it reports against
`gh run list --branch <branch>` before reading a cancelled run as red.

## Pins

Every external tool is pinned to an exact version, and every action to a commit SHA
with its tag in a comment. Dependabot opens weekly PRs for minor and patch updates
of npm packages and action pins (`.github/dependabot.yml`), and majors stay a
hand-written issue.

| Pin                                        | Where                                        | Source of the value                                 |
| ------------------------------------------ | -------------------------------------------- | --------------------------------------------------- |
| `setup-vp`                                 | `ci.yml`, `pr-title.yml` (SHA + `# v1.21.2`) | the release tag's commit, `gh api`                  |
| `actions/checkout`                         | all jobs (SHA + `# v5`)                      | the tag's commit                                    |
| `GITLEAKS_VERSION` + `GITLEAKS_SHA256`     | `ci.yml`, `checks` job                       | `gitleaks_<version>_checksums.txt` on the release   |
| `ACTIONLINT_VERSION` + `ACTIONLINT_SHA256` | `ci.yml`, `actions-gate` job                 | `actionlint_<version>_checksums.txt` on the release |
| `zizmor==<version>`                        | `ci.yml`, `actions-gate` job (`pipx run`)    | the PyPI release                                    |
| Node                                       | `.nvmrc`, `engines.node` and `Dockerfile`    | all three must match; see below                     |
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
4. Node: change `.nvmrc`, `engines.node` in `package.json`, and the `FROM` line in
   `Dockerfile`. The three must name the same version.
5. Push, and read the `actions-gate` result: its online audits (`impostor-commit`,
   `ref-version-mismatch`, `known-vulnerable-actions`) are the only check that a
   rewritten pin points at the tag its comment names.

## Running the gates locally

Everything in `checks` is a `pnpm` script, so a session can run it before pushing.
The migration checks and the audit compare against `origin/main`; fetch it first
(`git fetch origin main`). `actionlint` and `zizmor` are optional locally.

### Installing gitleaks locally

Optional: the pre-commit hook warns and skips when the binary is absent. Use the version
`GITLEAKS_VERSION` names in `ci.yml`:

```sh
curl -fsSL -o /tmp/gitleaks.tar.gz \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz
tar -xzf /tmp/gitleaks.tar.gz -C /tmp gitleaks && sudo mv /tmp/gitleaks /usr/local/bin/
```
