<!--
  The brief is a bug-hunting pass with one model: the author's tests are assumed to miss something.
-->

# Correctness

The bug-hunting axis of step 5 of the `implement` skill. It runs on every diff that changes
behaviour: beside the readback, or as the third axis of the full review. Standards asks whether
the code follows the repo's conventions and Spec whether it does what the issue asked; this one
asks whether it is **wrong**. The areas the brief names are where this codebase has been hurt.

1. Use the fixed point, diff command and commit list pinned for `code-review`, or for the
   readback.
2. Spawn **one** `reviewer-opus` sub-agent, in the same message as the other review spawns, with
   the diff command, the commit list, one paragraph stating what the change is meant to do, and
   the brief below. It runs on Opus while the other axes run on Codex models, so the axis that
   hunts for bugs brings a second model family. Codex has no Opus agent: under Codex, spawn
   `reviewer`.

   > Assume this diff has a bug its author's tests miss, and hunt for it. The stated intent is
   > correct; challenge the execution. Read the callers and callees of every changed function,
   > beyond the diff. Look where this codebase gets hurt: two appointments that overlap, or one
   > that falls outside its room block or its office's hours; an instant stored or shown in the
   > wrong time zone, or a bare `timestamp` where `timestamptz` belongs; a query on a tenant table
   > outside `withTenant()`, or a path that leaves a session setting behind for the next request;
   > a server function reachable by a user who should be refused (a receptionist reading a clinical
   > note, a request naming another organization's id); a clinical note edited or deleted in place;
   > an action that runs twice, or stops halfway; a migration the previous release runs against
   > during the deploy; empty, zero, null and boundary values; an error caught and dropped; patient
   > data that reaches a log, an error message or a job's log line; a guard that hides a broken
   > invariant where the invariant should be fixed; a rule the client and the server each enforce,
   > in two copies that disagree; a second write path (another action or route reaching the same
   > row) missing the authz or validation check the first one has; state that goes stale after a
   > submit, a revalidation or a navigation, an effect or a dialog that outlives what it belongs
   > to; an HTTP header, cookie or cache directive that leaks, caches or blocks what it should not;
   > a script that deletes or overwrites data pointed at the wrong target or run with an empty
   > variable.
   >
   > For each finding give its severity (`critical`: a wrong result, lost or corrupt data, a
   > security hole; `warning`: holds today and breaks under a condition you can name), the hunk
   > (file and line), and the **path** that triggers it: the input or sequence of calls, traced
   > through the code, that makes it go wrong. A suspicion you could not trace to a path goes
   > under "Untraced", one line each. Style, naming and structure belong to another reviewer.
   >
   > End with one line: `Would merge: yes | after fixes | no`, and the finding that decides it.
   > "No findings" is a valid review. Under 400 words.

3. Report it under `## Correctness`, after `## Standards` and `## Spec` or after `## Readback`,
   verbatim or lightly cleaned, and add its count and worst finding to the closing summary line.
