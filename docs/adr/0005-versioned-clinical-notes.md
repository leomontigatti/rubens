# ADR-0005: Clinical notes are versioned, files live on the server's disk

**Status**: accepted

Date: 2026-10-28. Supersedes the "Clinical records are append-only" section of
[ADR-0003](./0003-scheduling-and-clinical-records.md), after the clinical record
was agreed for the first version ([clinical-records.md](../domain/clinical-records.md)).

## A note is edited, and every version is kept

ADR-0003 made a signed note unalterable, with drafts before signing and addenda for
corrections. Practitioners fix typos and mistakes in their own notes, and drafts,
signing and addenda were three concepts to serve that. Ley 26.529 (art. 13) asks
an electronic record for integrity and inalterability; we read that as nothing
lost rather than nothing changed. That reading, and dropping the signing step, are
for counsel to confirm before go-live, beside the AAIP registration.

- A note is part of the record once saved. Its author, and only its author, edits
  it at any time; each save adds a version, and the database rejects any `UPDATE` or
  `DELETE` of a version. The note's text is its latest version.
- The history is shown in the record and the patient's copy marks an edited note,
  not only in the audit log: a reader of the record must see that a note changed.
- There are no drafts, no signing step and no addenda.
- A note or file that never belonged in the record (the wrong patient) is voided
  with a reason, since editing keeps every version. An admin can then delete the
  voided content for good, the one change the database allows on a version: its
  text cleared, the version and a placeholder kept, and the deletion audited.
- Every read and write of clinical content is still written to the append-only audit
  log in the same transaction, and RLS still keeps receptionists out.

## No application-level encryption at launch

ADR-0003 asked for clinical text to be encrypted by the app with a key outside the
database. Dropped for the first version: key custody, rotation and encrypting file
streams cost more than they buy for one practice on one VPS, where RLS, the audit
log and the encrypted off-site backups required before go-live
([infrastructure.md](../operations/infrastructure.md#backups)) are the protection.
The cost is that anyone who gets the server's disk or a database dump reads clinical
text in the clear. It returns as
hardening if counsel's review of the AAIP registration asks for it.

## Files live on a volume on the VPS

Attachments are files on a persistent volume Coolify manages, not in Postgres and
not in object storage: no second provider, and backups stay small. Files have no
public URL; the app streams each one after the access check, so every view is
audited. The off-site backup must cover the volume as well as the database
([infrastructure.md](../operations/infrastructure.md#backups)). Moving to object
storage later means copying the files and changing one storage module.

## Considered options

- **Append-only notes with addenda** (ADR-0003): the strictest reading of the law,
  rejected as too heavy for practitioners correcting their own typos when a kept
  version history meets the same requirement.
- **Object storage (R2, B2, MinIO)** for files: rejected for now; R2 is the
  candidate for the off-site backups instead.
