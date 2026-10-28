# ADR-0003, clinical section: signed notes are append-only

**Status**: superseded by [ADR-0005](../0005-versioned-clinical-notes.md) on
2026-10-28. The rest of [ADR-0003](../0003-scheduling-and-clinical-records.md) is
live. Kept for its rationale.

- A note is editable by its author while it is a draft. Once signed, it is never
  updated or deleted, and the database rejects such a change. A correction is a
  signed addendum that points at the note. Ley 26.529 asks for an unalterable
  record, kept at least ten years. Nothing in a record is deleted.
- Clinical text is also encrypted at the application level, with the key outside
  the database.
