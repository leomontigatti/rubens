# Proposals that name only what changes (#393)

Claude Haiku 5.5 on 2026-11-16, PR #396. The #393 cases five times each
(`move-pick-slot`, `short-proposal-accepted`, `shared-number-proposal`, `proposal-after-pause`,
`proposal-after-pause-and-side-question`, `proposal-after-staff-reply`,
`two-appointments-proposal`), on six versions of the proposal rule in `src/lib/assistant.ts`.

## The versions

The safeguard cases are the four that must state the proposal in full or name whose it is:
`shared-number-proposal`, `proposal-after-pause`, `proposal-after-staff-reply` and
`two-appointments-proposal`, plus `proposal-after-pause-and-side-question` in the last run.

| Rule                                                                                                                      | `move-pick-slot` (short form) | Safeguard cases | `short-proposal-accepted` |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------- | ------------------------- |
| One sentence, the short form with its exceptions (PR #396 as first opened; 3 runs)                                        | 1/13                          | 12/12           | 6/8                       |
| Short form first, "do not repeat", exceptions as a closing clause                                                         | 5/5                           | 1/20            | 4/5                       |
| Ordered checks (a)–(c) first, short form last                                                                             | 0/5                           | 20/20           | 4/5                       |
| Ordered checks, anchored on the assistant's last message                                                                  | 0/5                           | 20/20           | 2/5                       |
| Short form first, then "always" (a)–(c), anchored on the assistant's last message                                         | 2/5                           | 19/20           | 5/5                       |
| **Short form first, then "always" (a)–(c), anchored on the last message that named the appointment or offered its times** | **0/5**                       | **25/25**       | **5/5**                   |

The bold row ships, 30 of 35 turns whole (86%), no invented availability, no turn errored.
The row above it was shorter but anchored on any message of the assistant, so a reply that
names neither the appointment nor its times (`Sí, hay estacionamiento en la esquina.`) after a
pause let the next proposal drop the appointment; `proposal-after-pause-and-side-question`
pins that path. Its one safeguard failure, in `proposal-after-staff-reply`, named the current
and new day, time and office but neither the medical service nor the practitioner.

The whole set, once, on the row above the bold one: 51 turns, 88%. Its 6 failures were
`move-pick-slot` and 5 cases about handoffs and the health-question judgement
(`booking-for-a-toothache`, `new-request-during-handoff`, `confirm-during-reception-handoff`,
`confirm-and-repeat-during-reception-handoff`, `confirm-and-knee`), known since #359. Those 5,
three times each, scored 73% on this branch and 60% on `main`'s prompt.

## Other changes

- `shared-number-proposal`'s history now says the offered time is a new one for `Tomás`'s
  check-up, and the patient picks `el 18 a las 11`. `El miércoles` named the appointment's own
  weekday, and the model asked instead of proposing (0/3).
- `proposal-after-pause` now requires the appointment's current day or time, as a full
  statement names it.
- Without the pause note before `lo puedo cambiar?`, `move-pick-slot` scored 0/5 on the first
  rule and 3/5 on the row above the bold one: the note is not why the model restates.
- The accept rule says a proposal is stored however briefly it was worded:
  `short-proposal-accepted` went from 6/8 to 5/5 on every version that has it.

## Verdict

The safeguards hold on the shipped rule: a `sí` never had to accept a proposal whose patient
or appointment the conversation left unclear. The short form does not: when deciding whether a
pause came after the last message that named the appointment is the model's to judge, Haiku
restates the proposal in full (`del jueves 12/11 a las 16:30 al martes 17/11 … con Lic. Paula
Ríos`). A full proposal is safe, only longer. Making the short form reliable moves that
judgement into code, which knows where each pause and person's reply falls: the follow-up to
#393.
