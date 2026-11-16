# Proposals that name only what changes (#393)

Claude Haiku 5.5 on 2026-11-16, PR #396. The #393 cases (`move-pick-slot`,
`short-proposal-accepted`, `shared-number-proposal`, `proposal-after-pause`,
`proposal-after-staff-reply`, `two-appointments-proposal`) five times each, then the
whole set once.

## What was measured

The prompt PR #396 first opened with asked for the short form inside one long sentence
with its exceptions. On it, `move-pick-slot` gave the short proposal in 1 of 13 runs, and a
`sí` to a short proposal proposed again before accepting in 2 of 8 (a full proposal: 0 of
8). The safeguards held: pause, staff reply and two appointments 3/3, the reminder
confirmations 3/3.

| Prompt                                                                                   | #393 cases, whole turn      | `move-pick-slot` | Safeguard cases | `short-proposal-accepted` |
| ---------------------------------------------------------------------------------------- | --------------------------- | ---------------- | --------------- | ------------------------- |
| Short form first, "do not repeat", exceptions as a closing clause                        | 67% (60 turns, with others) | 5/5              | 1/20            | 4/5                       |
| Ordered checks (a)–(c) first, short form last                                            | 80%                         | 0/5              | 20/20           | 4/5                       |
| Ordered checks, anchor "your last message"                                               | 73%                         | 0/5              | 20/20           | 2/5                       |
| **Short form first, "do not repeat", then "always" (a)–(c), anchor "your last message"** | **87%**                     | **2/5**          | **19/20**       | **5/5**                   |
| The same, plus "do not say what it moves from"                                           | 80%                         | 3/5              | 16/20           | 5/5                       |

The bold row ships. The whole set on it, once: 51 turns, 88% whole turn, 100% tool choice
and no invented availability. Of the 6 failures, 5 are cases about handoffs and the
health-question judgement (`booking-for-a-toothache`, `new-request-during-handoff`,
`confirm-during-reception-handoff`, `confirm-and-repeat-during-reception-handoff`,
`confirm-and-knee`), known since #359. Run three times each, they scored 73% on this
branch and 60% on `main`'s prompt, so this change did not cause them.

## Other changes

- `shared-number-proposal`'s history now says the offered time is a new one for `Tomás`'s
  check-up, and the patient picks `el 18 a las 11`. `El miércoles` named the appointment's
  own weekday, and the model asked instead of proposing (0/3).
- Without the pause note before `lo puedo cambiar?`, `move-pick-slot` scored 3/5, against
  2/5 with it: the note is not why the model restates.

## Verdict

The safeguards hold: a `sí` never accepted a proposal whose patient or appointment the
conversation left unclear. The short form is not yet reliable: in `move-pick-slot` the
model still restates the practitioner and the current date 3 times in 5, echoing the
offered times' `con Lic. Paula Ríos`. A restated proposal is safe, only longer.
