# Booking new appointments on WhatsApp (LEO-7)

Claude Haiku 5.5 on 2026-11-26, PR #468, the whole set three times each: 62 cases, 186 turns. The same set on `main` (56ff408, 52 cases, 156 turns) is the comparison.

## Results

| Run                          | 1a tool choice | 1b no invented availability | 2 handoff when due | Reply content | Whole turn | USD/turn |
| ---------------------------- | -------------- | --------------------------- | ------------------ | ------------- | ---------- | -------- |
| `main` (56ff408)             | 99%            | 99%                         | 97%                | 92%           | 87%        | 0.00172  |
| This PR, first run (b18a6ee) | 97%            | 100%                        | 98%                | 91%           | 86%        | 0.00214  |
| This PR, shipped prompt      | 98%            | 100%                        | 98%                | 91%           | 88%        | 0.00219  |

No turn errored, and no reply named a time a tool did not return. A turn costs about 27% more than on `main`, from the three new tools' schemas and the longer prompt.

## What changed

The booking cases are new: a known patient asked for a preference and picking a time, an unknown number asked for a name and giving it, a guardian of two asked which, a medical service switched off, a named practitioner, `ninguno me sirve`, a rebooking after the practice cancelled, and `booking-for-a-toothache` (#359), which now expects a booking with no handoff and no advice.

## A regression found and fixed

On the first run `move-day-not-available` failed 0/3 (3/3 on `main`): with an upcoming appointment, `tenés algo para el sábado a la mañana?` after its reminder was read as a new booking, judged `booking: true`, and answered from `find_booking_times`, or with a question about which medical service. A patient who wanted to move would have booked a second appointment. The free-times rule in `src/lib/assistant.ts` now says that another time for an upcoming appointment, after a reminder or after the practice moved it, is a move unless the patient asks for another appointment. Run five times each, `move-day-not-available` and `change-tap-on-reminder` scored 5/5, and 3/3 in the shipped run.

## Failures left

- The four #393 move-proposal cases (`move-pick-slot`, `proposal-after-pause`, `proposal-after-pause-and-side-question`, `proposal-after-staff-reply`) fail 0/3 on `main` too: they still expect the office's name, `Norte`, which the one-office change (LEO-6, #466) took out of what the model reads. They are stale cases, not a regression.
- `confirm-during-reception-handoff` fails 0/3 here and on `main`, and the guardian case `guardian-names-patient` 1/3 here and on `main`.
- Flaky at 1/3 or 2/3 with no counterpart on `main`: asking for the preferred day before offering times (1/3), searching again after `ninguno me sirve` (2/3) and the unknown-number booking with the name given (2/3). In the failing turns the model offered times straight away, or proposed from a time it had already offered, without inventing any.

## Verdict

Booking ships on Haiku 5.5: 88% of turns whole against `main`'s 87%, with no invented availability. The preference question is the weakest new rule and the first to tighten when the next run is due. The stale #393 cases should be updated to the one office.
