# Validation

What a session runs before it commits, and which tool owns which concern. CI is
the merge gate; a session's job is to catch its own mistakes cheaply, not to
reproduce CI.

## Before committing

```sh
pnpm check                      # formatting check, lint and type check (`vp check`)
pnpm test:unit <path>...        # the unit test files your change touches
pnpm test:db <path>...          # the DB test files your change touches, when it touches the database
```

Run this once, after your edits. Do not run `pnpm test` in a session: it runs both
suites in series, and CI runs them in parallel. `pnpm check` prints only the
failures, each at its file and line; fix them and rerun it. Never pipe its output
into `tail` or `head`, which hides the failure.

Run `pnpm typecheck` and `pnpm build` one after the other, never in parallel.

## As you go

Each time a slice goes green, check that slice alone:

```sh
pnpm typecheck                  # types only, faster than `pnpm check`
pnpm test:unit <path>           # or `pnpm test:db <path>`: the one test file of the slice
```

## Ownership

| Command or gate                     | Owns                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                        | Formatting check, lint and type check, in one pass. `pnpm check:fix` writes the fixes it can.                                                                                                                                                                                                                                                                                                            |
| `pnpm format` / `pnpm format:check` | Oxfmt over the tree. The `PostToolUse` hook formats each file the agent writes, so a session rarely needs them.                                                                                                                                                                                                                                                                                          |
| `pnpm lint`                         | Oxlint, type-aware (`oxlint-tsgolint`): React hooks, import cycles, floating and misused promises, two ADR rules: no `pgTable`/`pgEnum` (ADR-0004) and no raw `db` client outside `src/db/` (ADR-0002), and the style guide's mechanical rules (`@shadcn/lint` and the `ui` plugin, [style-guide.md](./style-guide.md)). Its rules are in `vite.config.ts`; the custom ones are tested in `tests/lint/`. |
| `pnpm typecheck`                    | The TypeScript check on its own.                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm test:unit`                    | Vitest, the `unit` project: `src/**/*.test.{ts,tsx}`, `scripts/**/*.test.ts` and `tests/lint/`.                                                                                                                                                                                                                                                                                                          |
| `pnpm test:db`                      | Vitest, the `db` project: `*.db.test.ts` on in-process PGlite, and `tests/db/`. Its harness is described in [tests/db/README.md](../../tests/db/README.md).                                                                                                                                                                                                                                              |
| `pnpm check:migrations`             | Migration immutability, order and safety. An applied migration is never edited, and new ones follow the last one.                                                                                                                                                                                                                                                                                        |
| `pnpm check:dependency-audit`       | High and critical advisories that the branch introduces, against `main`.                                                                                                                                                                                                                                                                                                                                 |
| `pnpm check:fallow`                 | Dead code, unused dependencies and duplication that the branch adds, against `origin/main`. Read it by exit code: [fallow.md](./fallow.md).                                                                                                                                                                                                                                                              |
| `pnpm check:labels`                 | Every label a workflow, script or doc under `docs/agents/` names in a `gh` `--label` flag, a workflow condition or a `priority:`/`wayfinder:` name is in `.github/labels.json`. The labels and what they mean: [issue-tracker.md](./issue-tracker.md#labels).                                                                                                                                            |
| `pnpm check:comment-language`       | Engineering prose is English, over the whole tree: comments, test names, thrown `Error` messages, shell stderr, `#` and SQL `--` comments, and markdown. Spanish passes only marked as data ([coding-standards.md](./coding-standards.md#code-language)).                                                                                                                                                |
| `pnpm check:file-tokens`            | No tracked source file under `src/` above 5,500 estimated tokens; tests and generated files exempt.                                                                                                                                                                                                                                                                                                      |
| `pnpm check:pr-title "<title>"`     | A PR title is a conventional commit with an English subject. Run it before `gh pr create`; CI runs it again on every PR.                                                                                                                                                                                                                                                                                 |
| `.vite-hooks/pre-commit`            | On commit: gitleaks over the staged diff (it warns when the binary is missing; CI blocks), `vp staged` (format and lint fixes on staged files), `pnpm typecheck` and `pnpm check:fallow`.                                                                                                                                                                                                                |
| CI                                  | Everything above on the whole branch, plus the jobs in [ci.md](../operations/ci.md).                                                                                                                                                                                                                                                                                                                     |

The script index is [scripts.md](../operations/scripts.md). Run only commands that
exist in `package.json` or in that index; check before running a guessed one.

## Hooks inside the session

The project's agent hooks ([agent-configuration.md](./agent-configuration.md#session-hooks))
run two of these checks for you:

- every file the agent writes is formatted;
- the end of a turn is blocked while `pnpm check`'s lint or type check is red.

The shared workflow's hooks, installed at user level, add one more: `pkill -f` is
refused, in favour of `pnpm dev:stop` ([verification.md](./verification.md#cleanup)).

The `Stop` hook is a backstop, not a substitute for running `pnpm check` yourself.
`SKIP_STOP_CHECKS=1` turns it off for local work, never to get a red branch
committed.

## Browser checks

Anything the dev server renders is checked in a browser, following
[verification.md](./verification.md). A browser check is not a validation command,
and CI does not run it.

## Why not `pnpm test`

`pnpm test` is `test:unit && test:db`, in series. The DB suite is most of the
cost, and CI splits the work across jobs. A session runs the files it touched and
leaves the rest to CI.
