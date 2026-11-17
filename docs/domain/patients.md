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

A phone is typed as a country, Argentina by default, and the national number,
digits only, and stored in international format (E.164), the one WhatsApp needs.
An Argentine number is its 10 digits: the area code without its `0` and the
number without its `15`. A number that is not valid for its country is refused
when typed, because a misformatted mobile silently loses its reminders.

Ten Argentine digits do not say whether the line is a mobile or a landline, and
WhatsApp reaches a mobile only as `+54 9 …`. So an Argentine number is stored as
a mobile, `+54 9` and its 10 digits: a patient's or a guardian's phone is where
the organization's WhatsApp messages go, and a landline gets none of them under
either spelling. The cost falls on a landline given anyway: staff see it with a
`15` it does not have. A message that comes in finds its patients under either
spelling, so a number stored without the `9` still matches what WhatsApp sends,
and the search box finds a patient by the 10 digits under either spelling too.
The duplicate warning compares phones as stored: every phone typed in the app is
stored with the `9`, so the same number always compares alike, and an Argentine
number stored without it (only a seed or a test writes one) gains the `9` the
next time its record is saved.

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
leaves the search results; their data stays, and their future appointments go to the
"to reschedule" list ([appointments.md](./appointments.md#rescheduling)).

## Guardians

A patient can have one or more guardians, usually a minor's parents. A guardian is
a contact kept on the patient (name, relationship, document, phone, email), not a
link to another patient, even when the parent is a patient too. One guardian, or
the patient, is the contact that messages go to; the patient's own phone is the
default. A guardian signs a minor's consent forms, on paper.

A patient under 18 by birth date shows as a minor, and the app asks for a
guardian without requiring one: a teenager may book for themselves.

## WhatsApp consent

WhatsApp consent is on from registration. The patient gave the number and agreed
to WhatsApp contact, and that agreement can be collected in any form: the
registration form, or reception telling the patient that reminders come by
WhatsApp. The consent records when and by whom the patient was registered.

Opting out is the exception, not part of the flow, and messages offer no way to
unsubscribe. A patient who asks to stop, by any channel, is turned off by
reception, and that change is audited. A reply that looks like such a request
holds every message the organization starts to that number at once, for every
patient whose messages go to it, since someone who keeps getting them may block or
report the organization's number. Replies to the patient's own messages are not
held. It reaches reception and the admins as one notification per patient, which
links to the reply. Under that reply in the conversation, whoever reads it turns
each of those patients off or keeps them, as on the patient's record, and the
reply then shows who decided what, and when. A patient already held stays held
under the first reply. Each undecided patient's notification comes back unread
daily, and a decision resolves it for everyone. The hold lifts for each patient
as they are decided: a kept patient's held messages
go out, less those no longer true
([messages.md](./messages.md#when-meta-limits-the-number)), and a turned-off
patient's are dropped.
