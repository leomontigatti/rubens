# Readback

The review tier for a diff that touches none of the risky areas in step 5 of the `implement`
skill. It does not check the standards or the spec; it catches a diff that does something other
than what its author thinks it does.

1. Pin the fixed point: the branch point against the base branch. Confirm the diff
   (`git diff <base>...HEAD`) is non-empty and note `git log <base>..HEAD --oneline`.
2. Spawn **one** readback reviewer, as [Spawning a reviewer](SKILL.md#spawning-a-reviewer) says,
   with the diff command and the commit list, and this brief, in the same message as the
   correctness axis when the diff changes behaviour (step 5 of `implement`):

   > Read the diff. Restate in plain words what it does, as a reviewer would explain it to the
   > author. Then list anything surprising: behaviour the commit messages do not mention, a
   > change that looks unrelated to the rest, code that contradicts its own comment or name,
   > anything you would ask about before approving. Say "nothing surprising" if there is
   > nothing. End with one line: `Would merge: yes | after fixes | no`. Under 200 words.

3. Report it under `## Readback`, verbatim or lightly cleaned, ending with one line: how many
   surprises it flagged, and its merge verdict.

When a surprise turns out to touch money, results or judging, auth, a migration, a
`GLOSSARY.md` term or a destructive operational script, the diff was risky after all: run the
full `code-review`.
