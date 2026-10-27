# ADR-0003: Scheduling integrity and clinical records

**Status**: accepted

Date: 2026-10-12. Amended 2026-10-27, after the domain model was agreed
([docs/domain/](../domain/README.md)):

- Room blocks became weekly schedules, and room capacity is checked when a schedule is saved.
- Overbookings are exempt from the overlap constraint.
- Corrections are addenda rather than superseding versions.
- Clinical access is per practitioner setting, not per specialty.

Names follow FHIR where one fits (Location, Practitioner, PractitionerRole,
Schedule, Slot, Appointment, Encounter, Patient) without running a FHIR server.

## Double booking is impossible in the database

- An appointment's time is a `tstzrange`. An exclusion constraint
  (`btree_gist`, `practitioner_id WITH =, during WITH &&`) makes an overlapping
  appointment for one practitioner fail at insert, with no check-then-insert race.
  It is partial: cancelled and no-show appointments and overbookings are outside
  it. Overbooking is a deliberate staff action, and the flag is how it says so.
- Rooms are shared through **schedules**, not per appointment: a practitioner's
  weekly schedule holds a room ("consultorio 2, Monday 9–13") between two dates,
  and appointments fall inside it. A schedule recurs, so no range constraint can
  see its overlaps. Room capacity is checked when a schedule is saved, in the
  same transaction, under a lock on the room row: the schedule is expanded over
  its validity and compared with the room's other schedules.
- Instants are `timestamptz` in UTC. Each office has an IANA time zone, and local
  times are derived from it. A schedule is an RRULE with validity dates.
  Availability is the schedules expanded inside a bounded window, minus time off,
  closures and booked appointments.

## Clinical records are append-only

- Whether a practitioner keeps clinical records is a setting on the practitioner.
  Every practitioner who keeps them can read every patient's record in the
  organization. Ley 26.529 makes the institution the custodian, and access is
  audited rather than narrowed per treating practitioner.
- A note is editable by its author while it is a draft. Once signed, it is never
  updated or deleted, and the database rejects such a change. A correction is a
  signed addendum that points at the note. Ley 26.529 asks for an unalterable
  record, kept at least ten years. Nothing in a record is deleted.
- Every read and write of clinical data is written to an append-only audit log
  in the same transaction. The app role cannot `UPDATE` or `DELETE` it.
- Receptionists cannot read clinical notes, and RLS enforces that too.
- Clinical text is also encrypted at the application level, with the key outside
  the database.

Health data is sensitive data under Ley 25.326; registration with the AAIP,
consent and the hosting country are to be confirmed with local counsel before
go-live.
