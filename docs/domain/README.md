# Domain rules

The rules behind the terms in [GLOSSARY.md](../../GLOSSARY.md), agreed with the
business owner on 2026-10-27. The database-level guarantees that enforce some of
them are in [ADR-0003](../adr/0003-scheduling-and-clinical-records.md).

- [Access](./access.md): roles, and who sees what.
- [Scheduling](./scheduling.md): offices, rooms, schedules, time off, closures.
- [Appointments](./appointments.md): medical services, statuses, rescheduling, overbooking.
- [Patients](./patients.md): the registry, identity, guardians, consent.
- [Messages](./messages.md): templates, reminders, staff notifications.
- [Assistant](./assistant.md): what it does for patients, proposals,
  the inbox, handoff, communication rules, trying it.
- [Clinical records](./clinical-records.md), after the first version: notes and their versions, alerts, attachments, copies.

## Scope

underthing serves one business today, a dental practice. The organization, its one
office and its first admin are created by a script; there is no public sign-up, and
nothing adds a second office or archives the first. The data model stays
multi-organization.

Staff book in the app. Patients book, cancel and reschedule by WhatsApp, through
the assistant ([assistant.md](./assistant.md#for-patients)). underthing bills nothing.

Not in the first version, in rough order of arrival:

- Clinical records ([clinical-records.md](./clinical-records.md)): the practice keeps
  its own until they arrive. The odontogram is their first structured feature.
- A medical service's price, and the patient's part per insurer.
- Booking requests that wait for the practitioner's approval
  ([appointments.md](./appointments.md#booking-by-whatsapp)).
- A practitioner's licence number.
- Reply examples the assistant imitates ([assistant.md](./assistant.md#communication-rules)).
- Merging two patients.
- Treatment plans and quotes.
- A waitlist that offers freed times to other patients.
- Recurring appointments.
- Importing the national holiday calendar.
- Digital signatures (Ley 25.506) for consent forms.
- Billing, payments and insurer settlements.
- Online consultations: every appointment happens in a room.
