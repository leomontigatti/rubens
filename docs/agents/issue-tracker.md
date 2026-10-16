# Issue tracker: GitHub

Issues, PRDs and wayfinding maps live as GitHub issues. Use the `gh` CLI for every
operation; the local `gh` auth is the source of truth.

## Conventions

- **Create**: `gh issue create --title "..." --body-file <file>`. Write multi-line
  bodies to a file and pass it with `--body-file`, so the text never reaches the
  shell. Use `--parent <PRD>` to make an issue a native sub-issue.
- **Read**: `gh issue view <n>` for the body, then `gh issue view <n> --comments`. For a
  closed issue also read `stateReason`: `gh issue view <n> --json number,title,state,stateReason,closedAt,comments`.
- **Comment**: `gh issue comment <n> --body-file <file>`.
- **Labels**: `gh issue edit <n> --add-label "..."` and `--remove-label "..."`.
- **Close**: see [Closing an issue](#closing-an-issue).

Infer nothing from the title alone. Reading the body and its comments is the
first step of any issue work.

## Labels

- `ready-for-agent`: the issue says what to build and how to tell it is built. A
  session may pick it up.
- `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`,
  `wayfinder:grilling`, `wayfinder:task`: the [wayfinding](#wayfinding-operations)
  labels. They are the only labels a map or its tickets carry.

Create a missing label with `gh label create` before its first use.

## Closing an issue

Closing means a decision was made. It does not mean code changed.

| Outcome             | How to close                                                     | Closing comment                                  |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| **Built**           | A merged PR whose body says `Closes #N`, or `--reason completed` | none needed: the merged PR is the evidence       |
| **Deferred**        | `--reason "not planned"`                                         | **required**: `Closure: deferred to #<number>`   |
| **Decided against** | `--reason "not planned"`                                         | **required**: `Closure: decided against — <why>` |
| **Out of scope**    | `--reason "not planned"`                                         | **required**: `Closure: out of scope — <why>`    |
| **Duplicate**       | `--duplicate-of <number>`                                        | none needed: GitHub records the link             |

"Built" means the change is on `main`. A deferral names its follow-up issue, which
must exist before the close, and re-points anything blocked on this issue at the
follow-up with `gh issue edit <dependent> --add-blocked-by <follow-up>`: GitHub
counts a closed blocker as cleared.

Do not infer from `CLOSED` that anything was built. Check the code or the closing
discussion before repeating the claim anywhere durable.

## Ticket operations

The `to-spec` and `to-tickets` skills use this section.

- **The PRD** is an issue: `gh issue create --title "..." --body-file <file> --label ready-for-agent`,
  with the body from the `to-spec` template.
- **Tickets** are native sub-issues of the PRD, flat, created in the order they
  will be implemented: `gh issue create --parent <PRD> ...`, each with
  `ready-for-agent`. Check first that the PRD has no sub-issues yet
  (`gh issue view <PRD> --json subIssues`), and publish no slice before the user
  approves the slicing.
- **Blocking** is GitHub's native relation: `gh issue edit <ticket> --add-blocked-by <other>`.
  A "Blocked by #N" line in the body is for the reader; it does not block anything.
- **Two slices that each add a migration** get a blocking edge between them. Run in
  parallel, they would take the same migration number.
- **Test seams**: each ticket has a `## Test seams` section after its acceptance
  criteria, taken from the PRD's Testing Decisions ([Test seams](#test-seams)).
- **Do not close or edit the PRD** from a ticket session; the PRD PR closes it on merge.

## PRD workflow

- The PRD is filed per [Ticket operations](#ticket-operations).
- **Testing Decisions names the test seams**: the public interfaces the behaviour is
  tested through (a server function, a route's loader or action, a pure module). The
  `tdd` skill tests only at seams agreed up front, and this is the point where a
  human agrees them.
- Labels: `ready-for-agent` only. No other triage state is needed.

## Wayfinding operations

The `wayfinder` skill uses this section.

- **The map** is an issue labelled `wayfinder:map`. **Tickets** are native
  sub-issues of it: `gh issue create --parent <map> --label wayfinder:<type> ...`.
- **Blocking** is GitHub's native relation, as above.
- **The frontier** is the open, unassigned, unblocked children. List the children
  with `gh issue view <map> --json subIssues`, then keep those with no assignee and
  no open blocker (`gh issue view <n> --json assignees,blockedBy`).
- **Claiming** is `gh issue edit <ticket> --add-assignee @me`, before any work.
- **Exit shapes.** A map ends in one PRD with flat sub-issues when the slices touch
  the same files or are merged together, which is the default. Independent issues
  are only for slices that merge and revert alone. A chain of blocked standalone
  issues is the shape to avoid.

### Research tickets

A research ticket is resolved by the shared `research` agent: spawn it with the
ticket's question, in parallel for each research ticket, as
[agent-configuration.md](./agent-configuration.md#delegating-to-subagents) says. The
agent reports as text and leaves git and the tracker alone, so the session posts the
findings as a comment on the ticket, which is its resolution. A durable primary
source may be committed under `docs/research/<kebab-name>.md` on the session's own branch.

### Test seams

A ticket that settles how something is built records its test seams (the public
interfaces the behaviour is tested through) in its resolution. They land in the
PRD's Testing Decisions, which is where `to-tickets` and the implementing session
read them.
