# Skills started from upstream

Most of the skills in `.agents/skills/` started as copies of someone else's
(`mattpocock/skills` and its course repo, and Humanlayer's `show-me`). They are
ours now: a skill is edited like any other doc, with no byte-identical pin.

## Where each came from

| Skill                                                                                                                                  | Upstream                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `pr`, `prototype`, `tdd`, `to-spec`, `to-tickets`, `wayfinder` | [`mattpocock/skills`](https://github.com/mattpocock/skills) `skills/engineering/<name>`             |
| `grilling`, `handoff`, `writing-for-agents`                                                                                            | `mattpocock/skills` `skills/productivity/<name>`                                                    |
| `resolving-merge-conflicts`                                                                                                            | `mattpocock/skills`, which has since removed it; kept because `babysit-pr` and `implementer` use it |
| `implement` (from `do-work`, with `DB-TDD.md` and `FRONTEND-TDD.md`)                                                                   | [`mattpocock/course-video-manager`](https://github.com/mattpocock/course-video-manager), reshaped   |
| `implement-spec`                                                                                                                       | `mattpocock/skills` `skills/engineering/implement-spec`, adapted                                    |
| `babysit-pr`, `housekeeping`                                                                                                           | none                                                                                                |

The `pr` skill's Summary visuals come from [Dex Horthy](https://github.com/dexhorthy)'s
`show-me` skill; see [`.agents/skills/pr/CREDITS.md`](../../.agents/skills/pr/CREDITS.md).

## Pulling an upstream change

Nothing compares the skills with upstream. To take an improvement, read the upstream
diff, port what is wanted by hand, and keep the local changes where the two conflict.
There is no installer to re-run: `skills add` would overwrite local changes.
