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

A patient's first and last names, and a guardian's name, are saved in Spanish
title case whatever case they were typed in, so a name reads the same on every
screen and message: `juan DE LA cruz` is saved as `Juan de la Cruz`. The particles
`de`, `del`, `la`, `las`, `los` and `y` stay in lower case inside a name, and so
does a last name's leading one (`de la Cruz`); a part after a hyphen or an
apostrophe is capitalised (`Ana-Lía`, `O'Brien`).
Lists of people order them by last name, then first name, as Spanish sorts
them: ignoring case and accents, with `ñ` after `n`, so `de la Cruz` sits
between `Benítez` and `Díaz` and `Álvarez` among the `A`.

A patient may have a chosen name, which the app shows everywhere in place of the
legal name (Ley 26.743). It is kept as typed, since it is the person's own choice.
The legal name stays on documents and on the clinical-record copy.

A birth date is neither after today nor more than 100 years before it, today
being the organization's date. A patient saved earlier with a date outside those
bounds keeps it until the next save of their record, which asks for a valid one.

A phone is typed as a country, Argentina by default, and the national number,
digits only, and stored in international format (E.164), the one WhatsApp needs.
An Argentine number is its 10 digits, the area code without its `0` and the
number without its `15`, and the app shows it the same way (`351 555-1234`):
only the field's hint and the refusal of a wrongly typed number name the `0`
and the `15`. A number that is not valid for
its country is refused when typed, because a misformatted mobile silently loses
its reminders.

Every phone the app keeps is taken to be a mobile, and every call to one is
taken to be made from a mobile. WhatsApp reaches an Argentine mobile only as
`+54 9 …`, so an Argentine number is stored as `+54 9` and its 10 digits. This
holds for a patient's, a guardian's and the organization's urgent phone, which
the emergency reply gives. The server takes a phone only as the field's country
and number, so every Argentine phone is stored with the `9` and the duplicate
warning, which compares phones as stored, always compares the same number
alike. A message that comes in finds its patients under either spelling (`+54 9 …`
and `+54 …`: a landline shares a mobile's national numbers, so the two never name
different lines), and
the search boxes read a phone typed any local way (`0351 15 555-1234`), so a
number stored without the `9` before the phone field still matches; it gains the
`9` the next time its record is saved.

Allergies and medical alerts are not registration data: they are clinical and
live in the clinical record ([clinical-records.md](./clinical-records.md)).

## Coverage

A patient has zero or more coverages, each an insurer from the organization's
list (`obra social` or `prepaga`, kept by an admin), a plan and a member number. One
is primary. A patient with none is private (`Particular`).

## Identity

A patient has an optional identity document: a type (DNI, passport, other) and a
number, unique within the organization when present. It is optional so a baby
without a DNI yet, or a foreign patient, can still be registered. The type and the
number are given together or not at all. The number is saved without dots, spaces
or hyphens and in capitals, so `30.123.456` and `30123456` are the same document;
a DNI is 6 to 9 digits only.

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
