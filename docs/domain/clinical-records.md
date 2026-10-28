# Clinical records

A patient has one clinical record in the organization. Today every practitioner
keeps clinical records; whether one does is a setting on the practitioner, so a
future specialty that keeps none just has it off.

## Notes and addenda

A note belongs to the patient's record, written by one practitioner, and
optionally tied to an appointment. It is a draft, visible only to its author,
until the author signs it. Drafts let a practitioner write during the visit and
sign at the end; drafts left unsigned for a few days are flagged to their author.

A signed note never changes. A correction or addition is an addendum: signed by
its author, shown next to the note it amends, which stays as it was. Ley 26.529
asks for a record that cannot be altered.

Notes are free text. The odontogram, a per-tooth chart in FDI numbering kept as a
snapshot per visit, is the first structured feature after launch.

## Medical alerts

Allergies and medical alerts (allergic to penicillin, on anticoagulants,
diabetic) are part of the clinical record, shown at its top to practitioners and
never to reception.

## Attachments and consent

Files (X-rays, photos, scans) are attachments in the record. An informed-consent
form is an attachment of the consent type, with the date and who signed it: the
patient, or a guardian while the patient is a minor; a minor's consent form
cannot be stored without a guardian as the signer. Consent is a scan of a paper
signature for now.

## Copies for the patient

A patient may ask for a copy of their record, and Ley 26.529 gives the practice
48 hours to hand it over. A practitioner or an admin produces it as a PDF of the
signed notes, addenda and a list of attachments. Producing one is audited.

## Audit and retention

Every read and write of clinical content goes to the audit log
([ADR-0003](../adr/0003-scheduling-and-clinical-records.md)), the same log that
records changes to a patient's details ([patients.md](./patients.md)). Nothing in a record
is deleted: deactivating a patient hides them from search and keeps the record.
