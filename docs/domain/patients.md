# Patients

## One registry

The organization keeps one patient registry, shared by every practitioner and
receptionist. Reception, admins and practitioners all edit a patient's details;
only an admin deactivates a patient. Every change to a patient's details goes to
the audit log with who, when, and the values before and after, so a patient can
learn who changed their data (Ley 25.326).

## Registering

A patient can be registered with only a first name, a last name and a phone, so a
first booking by phone is quick. Such a patient is incomplete until the rest is
filled in at the first visit; the birth date is what completes the record,
because it says whether the patient is a minor. Forcing every field up front
only gets invented data.

A patient may have a chosen name, which the app shows everywhere in place of the
legal name (Ley 26.743). The legal name stays on documents and on the
clinical-record copy.

Phones are typed the local way ("0351 15…", "351…") and stored in international
format, the one WhatsApp needs. A number that cannot be read as a valid Argentine
number, or a foreign one with its country prefix, is refused when typed, because
a misformatted mobile silently loses its reminders.

Allergies and medical alerts are not registration data: they are clinical and
live in the clinical record ([clinical-records.md](./clinical-records.md)).

## Coverage

A patient has zero or more coverages, each an insurer from the organization's
list (`obra social` or `prepaga`, kept by an admin), a plan and a member number. One
is primary. A patient with none is private (`Particular`).

## Identity

A patient has an optional identity document: a type (DNI, passport, other) and a
number, unique within the organization when present. It is optional so a baby
without a DNI yet, or a foreign patient, can still be registered.

Reception finds a patient from one search box: by name, ignoring accents, case
and word order (`perez juan` finds `Juan Pérez`), by document number, or by phone
digits. Deactivated patients appear only on request.

Registering warns about likely duplicates (the same phone, or the same name and
birth date) and offers the existing patient; only the same document blocks.
Siblings share phones, so a phone match cannot block. Merging two patients is a
later admin tool, and it moves records, never deletes them.

## Never deleted

Patients and everything in their clinical record are kept for at least ten years
from the last entry (Ley 26.529), so a patient is deactivated, never deleted. The
one exception is a note or file voided from a record because it never belonged
there ([clinical-records.md](./clinical-records.md#voiding)). A deactivated patient
leaves the search results; their data stays.

## Guardians

A patient can have one or more guardians, usually a minor's parents. A guardian is
a contact kept on the patient (name, relationship, document, phone, email), not a
link to another patient, even when the parent is a patient too. One guardian, or
the patient, is the contact that messages go to; the patient's own phone is the
default. A guardian signs a minor's consent forms, on paper.

A patient under 18 by birth date shows as a minor, and the app asks for a
guardian without requiring one: a teenager may book for themselves.

## WhatsApp consent

WhatsApp consent is on from registration. Meta requires that the patient gave the
number and agreed to WhatsApp contact, and that agreement can be collected in any
form: the registration form, or reception telling the patient that reminders come
by WhatsApp. The consent records when and by whom the patient was registered.

Opting out is the exception, not part of the flow. The message templates offer no
way to unsubscribe (Meta asks for one only on marketing templates, and reminders
are utility templates). A patient who asks to stop, by any channel, is turned off
by reception, and that change is audited. A free-text reply that looks like such a
request reaches reception as a notification; nothing turns consent off on its own.
