# Issue tracker: Capy, with GitHub during the pilot

Issues, PRDs and wayfinding maps live in Capy's tracker. This is a pilot: the issues opened on
GitHub before it stay there until each one closes.

## Conventions

A code says which tracker holds an issue:

| Code    | Tracker | Reached with                                                             |
| ------- | ------- | ------------------------------------------------------------------------ |
| `LEO-N` | Capy    | the `tools.issue.*` calls below                                          |
| `#N`    | GitHub  | `gh` ([GitHub issues during the pilot](#github-issues-during-the-pilot)) |

- **New issues go to Capy**, except a PRD that needs slicing (below). An open GitHub issue is worked from GitHub until it closes, and
  moves to Capy only as a deferral ([Closing an issue](#closing-an-issue)).
- **`LEO-N` is the issue, `RUBE-N` is a thread.** Capy numbers issues across the whole
  organization, so the code after `LEO-12` may belong to another project: pass
  `project: "this"` to every list.
- **The calls run inside an `execute` program of a Capy thread**, which a subagent on its own
  machine has too. Each returns `{ text }`; a create's text opens with the new code
  (`LEO-12 created · Todo · …`), and every read's first lines list the organization's states
  and labels.
- **`implement-spec` waits for stage two.** It reads a PRD's sub-issues with `gh`, so a PRD
  that needs slicing is filed on GitHub with its tickets, or waits. A PRD one session builds is
  filed here.

The operations:

- **Create**: `tools.issue.create({ title, description, priority, labels: [...] })`. Pass a long
  body as a string the program read from a file
  (`(await tools.capy.read({ path })).content`), so the text never reaches a shell.
- **Read**: `tools.issue.read({ issue: "LEO-N" })` returns the fields, the description, the
  sub-issues, the relations and the timeline with every comment, newest first. A closed issue's
  status says how it closed: `Done` or `Canceled`.
- **Find**: `tools.issue.read({ project: "this", search: "<words>", status: "all" })` matches
  titles; add `search_in: "all"` for descriptions and comments.
- **Comment**: `tools.issue.comment({ issue, body })`. Capy signs a comment with its thread,
  so it carries no agent note.
- **Labels and priority**: `tools.issue.update({ issue, labels: [...], priority })`. `labels`
  replaces the whole set, so pass the ones that stay too.
- **Start**: `tools.issue.update({ issue, claim: true, status: "In progress" })` assigns the
  issue to this thread, and fails naming the holder when it is already assigned. An issue the
  read shows assigned to this thread already (the thread that launched the session may have
  assigned it) takes the status alone: `tools.issue.update({ issue, status: "In progress" })`.
- **Open the PR**: `tools.issue.update({ issue, status: "In review", link: ["leomontigatti/rubens#<pr>"] })`.
- **Close**: see [Closing an issue](#closing-an-issue).

Infer nothing from the title alone. Reading the description and its comments is the first step
of any issue work.

## Labels

Capy's labels belong to the organization, shared by every project in it. The tables below are
the whole list this repo uses; add one with
`tools.issue.label({ action: "create", name, color })`, then describe it here.

The shared skills speak of a few triage roles. Each maps to a label, a state or an assignee:

| Role                      | In Capy                                                         | Meaning                                                                            |
| ------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| needs triage              | label `needs-triage`                                            | Maintainer needs to evaluate this issue                                            |
| needs information         | label `question`, state `Needs you`, assigned to the maintainer | Not specified enough to act on; a person has to decide first                       |
| work an agent may pick up | label `ready-for-agent`, state `Todo`                           | Says what to build and how to tell it is built: a triage state, **not** a trigger  |
| work for a human          | state `Needs you`, assigned to the maintainer                   | Needs a human: a decision to settle or work an agent cannot do                     |
| will not be done          | none: close it                                                  | Close `Canceled` with a `Closure:` comment ([Closing an issue](#closing-an-issue)) |

"Assigned to the maintainer" is `assignee: "owner"`, the person who owns the thread: the issue
then shows in their Assigned view, which is their queue. The states are the organization's own,
used as they are: `Todo` (where a new issue starts), `In progress`, `In review`, `Needs you`,
`Waiting` and `Backlog` are open, `Done` and `Canceled` are closed.

There is no `needs-info` or `wontfix` label. With one maintainer there is no reporter to wait
on, so "needs more information" is a decision the maintainer owes, which is what `question` in
`Needs you` already says. And a decision not to do something is made by closing: an open
issue marked "will not be actioned" is a closure that did not happen.

`source:architecture-review` marks a PRD the weekly architecture review filed. The review lists
its earlier proposals by this label, so it stays on the issue after triage and after closing.

### Priority and type

The roles above say whether an issue can be picked up. They do not say how much it matters.
Triage also sets the priority field and at least one type label, and removes `needs-triage` on
the way out. A new issue is created at `normal`, so the field alone does not show that triage
happened: an issue still carrying `needs-triage` has not been triaged.

| Priority | Meaning                                                                             | Test                                   |
| -------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| `urgent` | Breaks bookings, patient data or a clinic's day, or a clinic cannot work without it | Would I drop what I am doing for this? |
| `high`   | The short list to pull from next. Keep it to about 15                               | Will I start this within two weeks?    |
| `normal` | Worth doing, no blocker, not scheduled                                              | Would I be sad to close it?            |
| `low`    | Parked: deliberately not now, and the issue names what wakes it                     | Is there a condition that reopens it?  |

`urgent` is usually empty: it is for appointments that are lost, double-booked or
shown at the wrong time, patient data that leaks across organizations or reaches someone it
should not, and anything that stops a clinic from running its day. A parked issue carries a
comment stating its wake-up trigger ("the first clinic asks for online payments"); without
one it is `normal`. Deciding against is a different thing: parked will be done when
the trigger fires, a rejected issue is closed.

A race is weighed as the `implement` skill's step 2 says, with the actors from
[review.md](review.md#hotspots). The usual recommendations here, which a measured frequency
or the fix's cost overrides:

- silent: an overlap that slips past the exclusion constraints, an appointment lost, or patient
  data reaching another organization: `high`, and `urgent` once a clinic is live;
- loud (a refusal or an error the receptionist retries) with nothing lost: `normal` at
  most;
- a window that needs one person in two places at once, or opens a few times a year:
  `low` with what would widen it, or closed as not planned when the fix costs more
  than the hits.

| Type label    | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| `bug`         | Wrong behaviour today                                            |
| `enhancement` | New capability or UX                                             |
| `refactor`    | Internal structure, no behaviour change                          |
| `chore`       | Dependencies, tooling, CI, docs or operations                    |
| `question`    | A decision to settle rather than work to do; sits in `Needs you` |

### The dispatch queue

The queue is the unassigned, unblocked `high` issues in `Todo` that carry `ready-for-agent`:

```js
await tools.issue.read({
  project: "this",
  status: ["Todo"],
  priority: ["high"],
  labels: ["ready-for-agent"],
  assignee: "none",
  relations: { exclude: ["blocked"] },
});
```

Blocking is Capy's native relation ([Ticket operations](#ticket-operations)), and no label
tracks it: an issue is blocked while one of its blockers is open, and a list marks it
`blocked`. Add `"sub_issue"` to `exclude` for the top-level view. Until the GitHub issues
close, the queue is this list plus [GitHub's](#github-issues-during-the-pilot).

Sub-issues are not triaged on their own: each takes its PRD's priority and type
([Ticket operations](#ticket-operations)).

`ready-for-agent` triggers nothing: a session picks the issue up from the queue above,
and no label starts a run.

### Wayfinding labels

`wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling` and
`wayfinder:task` are the [wayfinding](#wayfinding-operations) labels. They are the only labels
a map or its tickets carry: a map is not triaged, and the PRD it ends in is.

## Closing an issue

Closing means a decision was made. It does not mean code changed.

A merged PR closes no Capy issue. The PR body's closing line is `Closes LEO-N`, one line per
issue, and the thread closes each issue it names by hand once the PR has merged.

| Outcome             | How to close                                                                   | Closing comment                                    |
| ------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| **Built**           | after the merge, `tools.issue.update({ issue, status: "Done" })`               | none needed: the linked, merged PR is the evidence |
| **Deferred**        | `tools.issue.update({ issue, status: "Canceled" })`                            | **required**: `Closure: deferred to LEO-<number>`  |
| **Decided against** | `status: "Canceled"`                                                           | **required**: `Closure: decided against — <why>`   |
| **Out of scope**    | `status: "Canceled"`                                                           | **required**: `Closure: out of scope — <why>`      |
| **Duplicate**       | `tools.issue.update({ issue, status: "Canceled", related: ["LEO-<number>"] })` | **required**: `Closure: duplicate of LEO-<number>` |

"Built" means the change is on `main`. An issue in `In review` whose linked PR has merged was
left open by a thread that did not wake: close it as built. A deferral names its follow-up
issue, which must exist before the close, and re-points anything blocked on this issue at the
follow-up with `tools.issue.update({ issue: "<dependent>", blocked_by: ["<follow-up>"] })`: Capy
counts a closed blocker as cleared.

Do not infer from `Done` that anything was built. Check the code or the closing discussion
before repeating the claim anywhere durable.

## Ticket operations

The `to-spec` and `to-tickets` skills use this section.

- **The PRD** is an issue:
  `tools.issue.create({ title, description, priority, labels: ["ready-for-agent", "<type>"] })`,
  with the description from the `to-spec` template.
- **Tickets** are sub-issues of the PRD, one level deep, created in the order they will be
  implemented: `tools.issue.create({ title, description, parent: "<PRD>", priority, labels })`,
  each with the PRD's priority and type plus `ready-for-agent` ([Labels](#labels)). Check first
  that the PRD has none yet (`tools.issue.read({ parent: "<PRD>", status: "all" })` answers
  `No issues match.`), and publish no slice before the user approves the slicing. During the
  pilot a PRD with tickets lives on GitHub ([Conventions](#conventions)).
- **Blocking** is Capy's native relation: `blocked_by: ["<other>"]` on the create, or
  `tools.issue.update({ issue: "<ticket>", blocked_by: ["<other>"] })`. A "Blocked by LEO-N" line
  in the description is for the reader; it does not block anything.
- **Two slices that each add a migration** get a blocking edge between them. Run in
  parallel, they would take the same migration number.
- **Test seams**: each ticket has a `## Test seams` section after its acceptance
  criteria, taken from the PRD's Testing Decisions ([Test seams](#test-seams)).
- **Do not close or edit the PRD** from a ticket session; the PRD PR's thread closes it after
  the merge.

## PRD workflow

- The PRD is filed per [Ticket operations](#ticket-operations).
- **Testing Decisions names the test seams**: the public interfaces the behaviour is
  tested through (a server function, a route's loader or action, a pure module). The
  `tdd` skill tests only at seams agreed up front, and this is the point where a
  human agrees them.
- Triage: `ready-for-agent`, a priority and at least one type label
  ([Priority and type](#priority-and-type)). Ask the priority together with the seams when
  the conversation has not settled it. No other triage state is needed.

## Wayfinding operations

The `wayfinder` skill uses this section.

- **The map** is an issue labelled `wayfinder:map`. **Tickets** are sub-issues of it:
  `tools.issue.create({ title, description, parent: "<map>", labels: ["wayfinder:<type>"] })`.
- **Blocking** is Capy's native relation, as above.
- **The frontier** is the open, unassigned, unblocked children:
  `tools.issue.read({ parent: "<map>", assignee: "none", relations: { exclude: ["blocked"] } })`.
- **Claiming** is `tools.issue.update({ issue: "<ticket>", claim: true })`, before any work.
- **Exit shapes.** A map ends in one PRD with flat sub-issues when the slices touch
  the same files or are merged together, which is the default. Independent issues
  are only for slices that merge and revert alone. A chain of blocked standalone
  issues is the shape to avoid.

## Research tickets

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

## GitHub issues during the pilot

The open `#N` issues, and a PRD filed with tickets for `implement-spec`, follow every rule
above with GitHub's commands and labels. The label list is
[`.github/labels.json`](../../.github/labels.json), pushed with `pnpm labels:sync` and held
to by `pnpm check:labels` ([scripts.md](../operations/scripts.md)). It changes only for a
label a GitHub issue still needs.

| Here                      | On GitHub                                                        |
| ------------------------- | ---------------------------------------------------------------- |
| priority `urgent`         | `priority:urgent`                                                |
| priority `high`           | `priority:next`                                                  |
| priority `normal`         | `priority:later`                                                 |
| priority `low`            | `priority:parked`                                                |
| `Needs you`, assigned     | `ready-for-human`                                                |
| every other label         | the label of the same name                                       |
| `Done`                    | a merged PR whose body says `Closes #N`, or `--reason completed` |
| `Canceled`                | `--reason "not planned"`, after the same `Closure:` comment      |
| `Canceled` as a duplicate | `--duplicate-of <number>`, no comment                            |

An issue with no `priority:*` label has not been triaged. A deferral to Capy comments
`Closure: deferred to LEO-<number>` and closes as not planned; the Capy issue's description
links back to the GitHub issue. No relation crosses the trackers, so an issue that blocks an
open GitHub issue, or is blocked by one, stays on GitHub.

- **Create**: `gh issue create --title "..." --body-file <file>`, with `--parent <PRD>` for a
  native sub-issue. Bodies and comments go through `--body-file`, so the text never reaches
  the shell, and a comment opens with the agent note of the `pr` skill.
- **Read**: `gh issue view <n>`, then `gh issue view <n> --comments`. For a closed issue also
  read `stateReason`: `gh issue view <n> --json number,title,state,stateReason,closedAt,comments`.
- **Comment**: `gh issue comment <n> --body-file <file>`.
- **Labels**: `gh issue edit <n> --add-label "..."` and `--remove-label "..."`.
- **Close**: `gh issue close <n> --reason "not planned"`, after the comment.
- **Blocking**: `gh issue edit <ticket> --add-blocked-by <other>`; GitHub counts a closed blocker
  as cleared.
- **The queue**: `gh issue list --label priority:next --label ready-for-agent`, skipping an
  issue whose
  `gh issue view <n> --json blockedBy --jq '[.blockedBy.nodes[] | select(.state == "OPEN") | .number]'`
  lists an open blocker. `blockedBy` and `subIssues` are objects, `{nodes, totalCount}`, so a
  query reads `.nodes[]`. Add `--search "no:parent-issue"` for the PRD-level view.
- **A PRD's tickets**: `gh issue view <PRD> --json subIssues --jq '.subIssues.totalCount'` is `0`
  before slicing; its open ones are
  `gh issue view <PRD> --json subIssues --jq '.subIssues.nodes[] | select(.state == "OPEN") | .number'`.
