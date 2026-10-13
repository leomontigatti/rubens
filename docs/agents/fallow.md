# Fallow

[Fallow](https://fallow.tools) finds dead code (unreachable files, unused exports
and types), unused dependencies and duplication. It is a gate and an investigation
tool. Config: `.fallowrc.json`.

## The gate

`pnpm check:fallow` (`fallow audit --quiet --gate-marker agent --base origin/main`)
runs in `.vite-hooks/pre-commit` and in CI's `checks` job. Locally it reads the
working tree, not only what is staged, the same as `pnpm typecheck`; CI judges the
pushed branch. It fails only on what
this branch **adds** on top of `origin/main`. Findings already on `main` are
reported as inherited and don't fail it, so a red gate always names something the
branch did.

`--base origin/main` is deliberate. Without it the audit bases on the branch's own
last push, and the first merge of `main` into an open branch would attribute
everything `main` brought in to that branch.

Read it by **exit code**, unpiped: `pnpm check:fallow; echo $?`. A pipe into
`tail` or `grep` reports that command's status instead.

- **0**: pass. Anything printed is information, such as inherited findings,
  duplication or the `unused-dependencies` warnings.
- **1**: the findings listed are this branch's. Fix them.
- **2**: fallow could not run (a bad config, or `origin/main` missing or shallow).
  The branch was never checked, so never treat it as a pass. Run `git fetch origin`
  and retry.

Severity choices, each explained in `.fallowrc.json`:

- **Unused dependencies only warn.** ADR-0001's libraries arrive before the
  features that import them. A dependency still unused once its feature exists is a
  candidate for removal.
- **Duplication only warns,** from three copies up. When it fires, the fix is
  usually to extract the shared idiom, not to suppress the warning.

## Investigating

| Before you...                        | Run                                                    |
| ------------------------------------ | ------------------------------------------------------ |
| delete an "unused" export or file    | `pnpm exec fallow dead-code --trace <file>:<export>`   |
| delete an "unused" dependency        | `pnpm exec fallow dead-code --trace-dependency <name>` |
| hand off a changeset                 | `pnpm exec fallow audit --base origin/main`            |
| pick what to refactor                | `pnpm exec fallow health --hotspots --targets`         |
| look for reachable code with no test | `pnpm exec fallow health --coverage-gaps`              |

`pnpm exec fallow dead-code` with no flags lists everything, inherited findings
included. Expect scaffolding that has no user yet, such as shadcn components and the
auth client; it stays until a feature uses it or it is deleted.
