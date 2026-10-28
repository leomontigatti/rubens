# Clinical records

A patient has one clinical record in the organization. Today every practitioner
keeps clinical records; whether one does is a setting on the practitioner, so a
future specialty that keeps none just has it off. How notes are kept is in
[ADR-0005](../adr/0005-versioned-clinical-notes.md).

## Where it lives

The record is a `Historia clínica` tab on the patient's page, shown only to
practitioners who keep clinical records. It lists notes newest first, with the
active medical alerts pinned at the top. An appointment in the day view offers
`Escribir evolución`, which opens a new note tied to it.

## Notes

A note belongs to the patient's record, written by one practitioner, and
optionally tied to an appointment. It is free text, and part of the record once
saved: there are no drafts and no signing step.

The author, and only the author, can edit their note at any time. Every version is
kept: the note shows `Editado` and its earlier versions with their dates. A late
finding, such as an X-ray that arrives after the visit, is a new note.

Notes are free text. The odontogram, a per-tooth chart in FDI numbering kept as a
snapshot per visit, is the first structured feature after launch.

A practitioner can have a licence number (`Matrícula`), set by an admin. It is
optional, and shown next to the author's name on screen and in copies.

## Medical alerts

Allergies, conditions and medications a practitioner must know before treating
(allergic to penicillin, on anticoagulants, diabetic) are a list at the top of the
record, not part of a note, and never shown to reception. An alert has a type
(`Alergia`, `Condición` or `Medicación`), a short text and an optional detail. Any
practitioner who keeps records adds one or resolves it with a reason; a resolved
alert leaves the active list and keeps its history.

## Attachments

Files are attached to a note: the note carries the date, the author and the text,
so a file needs nothing of its own. JPEG, PNG, WebP, HEIC and PDF up to 25 MB, from
a computer or a phone's camera. Radiographs come in as images or PDFs; there is no
DICOM viewer.

While a file is on a note, its author can remove it by editing the note; the
version history keeps that it was there. A file that should not be in the record
at all, such as one on the wrong patient, is voided by the note's author with a
reason. An admin reviews voided files and can delete one for good: it is another
person's data, or none. The audit log keeps who voided and deleted it, when, why,
and the file name.

## Consent forms

The practice prints its own consent form and the patient, or a guardian, signs it
on paper. The scan is attached to a note that says what it covers and who signed;
Rubens keeps no structured consent fields and prints no forms. The paper original is
kept by the practice as the evidence of the signature (how long is a question for
counsel; ten years, like the record, is the safe assumption).

## Copies for the patient

A patient may ask for a copy of their record, and Ley 26.529 gives the practice
48 hours to hand it over. A practitioner or an admin produces it as a PDF, built
when asked and not stored:

- a header with the organization, the patient's name, document and birth date, the
  date of issue and who issued it;
- the active medical alerts;
- the notes in date order, each with its author, licence number and date, marked
  `Editado el …` when edited, with its current text;
- the list of attached files by note; the files themselves are handed over apart
  if asked.

Voided files are left out. The audit entry records who issued it and when; since
nothing is lost, the same copy can be rebuilt.

## Audit and retention

Every read and write of clinical content goes to the audit log
([ADR-0003](../adr/0003-scheduling-and-clinical-records.md)), the same log that
records changes to a patient's details ([patients.md](./patients.md)): one entry each
time a record is opened, each file viewed or downloaded and each copy produced, and
one per change. There is no screen for the log yet; it is queried when a patient
asks who saw their record. Nothing in a record is deleted except a voided file:
deactivating a patient hides them from search and keeps the record.
