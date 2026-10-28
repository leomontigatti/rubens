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

The list of labels (name, colour, description) is [`.github/labels.json`](../../.github/labels.json);
this section says what they mean. Add or change a label in the JSON, run `pnpm labels:sync`,
then describe it here. `pnpm check:labels` fails CI when a workflow, a script or a doc in this
directory names a label the file does not hold in a `--label` flag or a `priority:` or
`wayfinder:` name ([scripts.md](../operations/scripts.md)), so write label commands in full.

The shared skills speak of a few triage roles; each maps to a label here:

| Role                      | Label                          | Meaning                                                                               |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| needs triage              | `needs-triage`                 | Maintainer needs to evaluate this issue                                               |
| needs information         | `question` + `ready-for-human` | Not specified enough to act on; a person has to decide first                          |
| work an agent may pick up | `ready-for-agent`              | Says what to build and how to tell it is built: a triage state, **not** a trigger     |
| work for a human          | `ready-for-human`              | Needs a human: a decision to settle or work an agent cannot do                        |
| will not be done          | none: close it                 | Close `not planned` with a `Closure:` comment ([Closing an issue](#closing-an-issue)) |

There is no `needs-info` or `wontfix` label. With one maintainer there is no reporter to wait
on, so "needs more information" is a decision the maintainer owes, which is what `question` +
`ready-for-human` already say. And a decision not to do something is made by closing: an open
issue labelled "will not be actioned" is a closure that did not happen.

`dependencies` and `javascript` are the labels Dependabot puts on its PRs. They stay in the
file so a sync never finds them missing, and triage does not use them.

### Priority and type

The roles above say whether an issue can be picked up. They do not say how much it matters.
Triage also gives every issue exactly one priority label and at least one type label, and removes
`needs-triage` on the way out. An issue with no `priority:*` label has not been triaged.

| Priority label    | Meaning                                                                             | Test                                   |
| ----------------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| `priority:urgent` | Breaks bookings, patient data or a clinic's day, or a clinic cannot work without it | Would I drop what I am doing for this? |
| `priority:next`   | The short list to pull from next. Keep it to about 15                               | Will I start this within two weeks?    |
| `priority:later`  | Worth doing, no blocker, not scheduled                                              | Would I be sad to close it?            |
| `priority:parked` | Deliberately not now, and the issue names what wakes it                             | Is there a condition that reopens it?  |

`priority:urgent` is usually empty: it is for appointments that are lost, double-booked or
shown at the wrong time, patient data that leaks across organizations or reaches someone it
should not, and anything that stops a clinic from running its day. A parked issue carries a
comment stating its wake-up trigger ("the first clinic asks for online payments"); without
one it is `priority:later`. Deciding against is a different thing: parked will be done when
the trigger fires, a rejected issue is closed.

| Type label    | Meaning                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `bug`         | Wrong behaviour today                                                     |
| `enhancement` | New capability or UX                                                      |
| `refactor`    | Internal structure, no behaviour change                                   |
| `chore`       | Dependencies, tooling, CI, docs or operations                             |
| `question`    | A decision to settle rather than work to do; pairs with `ready-for-human` |

### The dispatch queue

The queue is `priority:next` plus `ready-for-agent`:
`gh issue list --label priority:next --label ready-for-agent`. Skip an issue whose
`gh issue view <n> --json blockedBy` still lists an open blocker: blocking is GitHub's native
relation ([Ticket operations](#ticket-operations)), and no label tracks it.

Sub-issues are not triaged on their own. `to-tickets` creates each slice with its PRD's priority
and type ([Ticket operations](#ticket-operations)). That multiplies a PRD in any priority list,
so add `no:parent-issue` for the PRD-level view:
`gh issue list --label priority:next --search "no:parent-issue"`.

`ready-for-agent` triggers nothing: a local session picks the issue up from the queue above,
and no label starts a run.

### Wayfinding labels

`wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` and
`wayfinder:task` are the [wayfinding](#wayfinding-operations) labels. They are the only labels
a map or its tickets carry: a map is not triaged, and the PRD it ends in is.

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

- **The PRD** is an issue: `gh issue create --title "..." --body-file <file> --label ready-for-agent --label priority:<p> --label <type>`,
  with the body from the `to-spec` template.
- **Tickets** are native sub-issues of the PRD, flat, created in the order they
  will be implemented: `gh issue create --parent <PRD> ...`, each with the PRD's
  priority and type plus `ready-for-agent` ([Labels](#labels)). Check first that the PRD has no sub-issues yet
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
- Labels: `ready-for-agent`, one `priority:*` and at least one type label
  ([Priority and type](#priority-and-type)). Ask the priority together with the seams when
  the conversation has not settled it. No other triage state is needed.

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
