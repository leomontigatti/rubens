# Dependency updates

The npm packages are bumped by a weekly Capy automation, not by Dependabot: a bump often needs
an edit beside it (an override, a skill copy, a code fix), and Dependabot can only bump. This file
is the automation's procedure; its prompt only points here, so the procedure is reviewed like
code. Dependabot still bumps the action pins ([ci.md](../operations/ci.md#pins)).

## The automation

- **Where:** the Capy automation "Dependency update" in project `rubens`, every Wednesday at
  09:00 America/Cordoba. A missed week is caught up by the next run, since every run updates to
  the newest versions.
- **What it does:** each run starts a new Capy thread on a cloud machine, set up by the project's
  Setup. That thread is the run. Its prompt:

  > Update the npm dependencies by docs/agents/dependency-updates.md § The run. This run is
  > unattended: there is no user to ask, so make every call yourself.

## The run

The thread runs these in its own checkout. It does not call the `implement` skill as a whole:
there are no seams to test first, only the steps below.

0. **Start from `origin/main`**: `git fetch origin && git merge --ff-only origin/main`, then
   `pnpm install --frozen-lockfile`. The machine's checkout can start from a commit behind
   `origin/main`; the install brings `node_modules` level with the lockfile the merge brought in.
1. **Update within each range**: `pnpm update`. That moves every caret range and every transitive
   dependency, and never crosses a major (on `0.x`, never a minor). `minimumReleaseAge` in
   `pnpm-workspace.yaml` stays in force: a version too new is left for next week, and the run never
   adds a `minimumReleaseAgeExclude` entry.
2. **Move the exact pins**, which `pnpm update` leaves alone. For each dependency `package.json`
   pins to an exact version, newest first in the same major:
   `pnpm update <package>@<major>` resolves the newest version old enough, then
   `pnpm add -E <package>@<that version>` writes it back exact (the first command alone leaves the
   range `"<major>"`). `pnpm list --depth 0 --json` prints the version it resolved. `@playwright/test`
   is one of them; the Chromium it installs follows it.
3. **Move the Vite+ overrides with `vite-plus`.** When step 1 moved `vite-plus`, set `vite@*` in
   `overrides` (`pnpm-workspace.yaml`) to the alias `vite-plus` itself names
   (`pnpm view vite-plus@<version> dependencies.vite`; since 1.7.0 the core's version encodes the
   bundled Vite, `8.3.8000` for Vite `8.3.8`, not the `vite-plus` version), and `vitest@*` to the
   version `pnpm exec vp toolchain vitest` prints, then `pnpm install`. Bumped alone, the two
   Vite copies fail the type check (TS2321 in `vite.config.ts`).
   When `wrangler` moved, run `pnpm types:generate`: the runtime types follow the workerd it
   brings, and `pnpm check:worker-types` fails in CI until they are regenerated.
4. **Copy the dependency skills again**:
   `DISABLE_TELEMETRY=1 pnpm exec skills experimental_install --force --no-frozen-lockfile -a codex -a claude-code`.
   It copies every entry in `skills-lock.json` again from `node_modules`; a skill whose package
   did not move comes out unchanged ([agent-configuration.md](./agent-configuration.md#the-shared-workflow-and-what-stays-here)).
5. **Leave new skill grants denied.** When `pnpm permissions list` shows a package asking to
   provide skills that `permissions` in `pnpm-workspace.yaml` does not name, add a
   `skills: false` entry for it and name the package in the PR, so a person decides whether one of
   its skills is worth copying. The run approves no package.
6. **Validate the whole tree**, since a bump reaches every suite: `pnpm check`, `pnpm test:unit`
   and `pnpm test:workers` with no paths, then `pnpm build`, `pnpm check:dependency-audit` and
   `pnpm check:fallow`. `pnpm test:e2e` runs in CI ([validation.md](./validation.md#heavy)).
7. **Fix what breaks, or hold the package back.** A fix is code like any other, held to
   [coding-standards.md](./coding-standards.md). A package the run cannot fix goes back to its old
   version and into `updateConfig.ignoreDependencies` in `pnpm-workspace.yaml`, which `pnpm update`
   skips, with a comment above it: what breaks, and the issue the run opens for the fix. Step 2
   skips the packages listed there too.
   A new lint warning is not a break: the run leaves the code alone, so the PR stays a bump, and
   opens one issue per new rule, naming its files. Compare `pnpm lint` against `origin/main`'s, by
   rule and file: a count alone misreads the warnings already on `main` as new.
8. **Audit the whole tree**: `pnpm audit --audit-level high`. `check:dependency-audit` fails only
   on advisories a branch adds, so nothing else reports one published against a package already
   on `main`: Dependabot alerts are off. For each high or critical advisory still open, the PR's
   `## Review` names the package, its path (`pnpm why <package>`) and whether it reaches the
   Worker or only the dev tooling, and one that reaches the Worker also gets an issue. The run adds
   no `overrides` or `audit.ignore` entry for an advisory: a person decides those.
9. **List the pins nothing bumps.** The tools pinned by hand in
   [ci.md](../operations/ci.md#pins) (gitleaks, actionlint, zizmor, Node, pnpm) are bumped by no
   one, so the run reports the ones behind, without bumping them: the bump needs a checksum or a
   second file moved with it, which ci.md § How to bump says. Their newest releases:
   `gh release view -R gitleaks/gitleaks --json tagName` and the same for `rhysd/actionlint`;
   `curl -s https://pypi.org/pypi/zizmor/json | jq -r .info.version`; the newest Node in the
   `.nvmrc` major from `https://nodejs.org/dist/index.json`; `pnpm view 'pnpm@<major>' version`
   for the major `packageManager` names. A new major of any of them is reported as one.
10. **Open the PR**, or end without one when steps 1 to 5 changed nothing; the thread's last
    message then carries the audit's findings and the pins behind, since there is no PR to hold
    them. One PR titled `build(deps): update the npm dependencies for the week of <date>`,
    written by the `pr` skill. Its `## Review` record lists the packages that moved (from, to),
    the skills that changed, a new or widened instruction in a changed skill (it is instructions
    agents will follow, so it is read as such), the packages held back, the audit's findings and
    the pins behind. The review tier is the one `review.py tier` prints. Then this thread
    babysits the PR by the `babysit-pr` skill until it is ready to merge, and merges it under the
    standing merge permission in the root `AGENTS.md`.

## What stays by hand

- **A major**, of any package: a hand-written issue, because it needs its release notes read
  against this repo ([ADR-0001](../adr/0001-stack.md)).
- **A package in `updateConfig.ignoreDependencies`**: its comment says what has to happen before it
  moves again, and the issue it names tracks that.
