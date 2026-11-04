# Domain rules

The rules behind the terms in [GLOSSARY.md](../../GLOSSARY.md), agreed with the
business owner on 2026-10-27. The database-level guarantees that enforce some of
them are in [ADR-0003](../adr/0003-scheduling-and-clinical-records.md).

- [Access](./access.md): roles, and who sees what.
- [Scheduling](./scheduling.md): offices, rooms, schedules, time off, closures.
- [Appointments](./appointments.md): medical services, statuses, rescheduling, overbooking.
- [Patients](./patients.md): the registry, identity, guardians, consent.
- [Messages](./messages.md): reminders, the reschedule link, staff notifications.
- [Assistant](./assistant.md): what it does for patients and practitioners, proposals,
  handoff, communication rules.
- [Clinical records](./clinical-records.md): notes and their versions, alerts, attachments, copies.

## Scope

Rubens serves one business today, a dental practice with several offices. The
organization, its offices and its first admin are created by a script; there is
no public sign-up. The data model stays multi-organization.

Staff book in the app. Patients book, cancel and reschedule by WhatsApp, through
the assistant, and act on an appointment they already have through its reschedule
link. Prices are information for patients; Rubens bills nothing.

Not in the first version, in rough order of arrival:

- The odontogram, the first structured clinical feature after launch.
- Treatment plans and quotes.
- A waitlist that offers freed times to other patients.
- Recurring appointments.
- Importing the national holiday calendar.
- Digital signatures (Ley 25.506) for consent forms.
- Billing, payments and insurer settlements.
- Online consultations: every appointment happens in a room.
