# ADR-0003: Scheduling integrity and clinical records

**Status**: proposed — the direction agreed while choosing the stack; the schema
work confirms or amends it.

Date: 2026-10-12

Names follow FHIR where one fits (Location, Practitioner, PractitionerRole,
Schedule, Slot, Appointment, Encounter, Patient) without running a FHIR server.

## Double booking is impossible in the database

- An appointment's time is a `tstzrange`. An exclusion constraint
  (`btree_gist`, `professional_id WITH =, during WITH &&`, partial on
  non-cancelled statuses) makes an overlapping booking for one professional fail
  at insert, with no check-then-insert race.
- Rooms are shared at the **block** level, not per appointment: a professional
  holds a room for a range ("room 2, Monday 9–13") and appointments fall inside
  the block. Exclusive rooms use the same exclusion constraint on blocks; shared
  rooms have a `capacity` enforced by a trigger that locks the room row and counts
  overlapping blocks.
- Instants are `timestamptz` in UTC. Each office has an IANA time zone, and local
  times are derived from it. Recurring availability is an RRULE plus exceptions,
  expanded to concrete slots inside a bounded window.

## Clinical records are append-only

- A professional's role (by specialty) says whether it keeps a clinical history.
- A note is never updated or deleted: an edit is a new version that supersedes
  the old one. Ley 26.529 asks for an unalterable record, kept at least ten years.
- Every read and write of clinical data is written to an append-only audit log
  in the same transaction. The app role cannot `UPDATE` or `DELETE` it.
- Receptionists cannot read clinical notes, and RLS enforces that too.
- Clinical text is also encrypted at the application level, with the key outside
  the database.

Health data is sensitive data under Ley 25.326; registration with the AAIP,
consent and the hosting country are to be confirmed with local counsel before
go-live.
