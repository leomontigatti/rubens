# Messages

## To patients

Messages go by WhatsApp to patients with WhatsApp consent; a patient without it
gets none. There is no email to patients for now. WhatsApp goes through the
organization's number on Meta's Cloud API
([ADR-0010](../adr/0010-whatsapp-cloud-api-number-per-organization.md)).

Every message the organization starts is a template Meta approved for the
organization, in its own voice: the set is in
[whatsapp-templates.md](../operations/whatsapp-templates.md). Rubens fills in its
facts (the date, the time, the practitioner, the office). Templates carry no
buttons: the patient answers in their own words, and the assistant reads the
answer ([assistant.md](./assistant.md)). The patient's answer opens the
conversation window ([assistant.md](./assistant.md#the-conversation-window)).

Messages the organization starts go only to patients who booked with it, and stop
for a patient who asks to stop.

Each medical service sets:

- **The booking confirmation**, sent when the appointment is booked, or not at all.
- **Its reminders**: each one a time before the appointment (such as 48 h and
  2 h), and whether it asks the patient to confirm. A reminder whose send time has
  already passed when the appointment is booked is skipped, not sent late. A
  request gets no reminders until it is approved; the same rule then applies from
  the approval.
- **Its care instructions**: a text sent when the appointment is marked attended,
  or none.
- **Its follow-up**: a time after the appointment at which the patient is asked
  how they feel, or none.
- **The reschedule cutoff**: how long before the appointment the patient can still
  move it through the assistant ([assistant.md](./assistant.md#cancelling-and-moving)).

An answer to a reminder that asks for confirmation can:

- **confirm**, which sets the appointment to confirmed;
- **cancel**, which cancels it, by the patient, and frees the time;
- **ask to reschedule**, which the assistant handles in the conversation, offering
  times ([assistant.md](./assistant.md#cancelling-and-moving)).

An answer to a follow-up is only sorted: plainly good gets a thank-you; anything
else is handed off to the practitioner; an emergency gets the fixed emergency
reply. The assistant gives no advice, and writes nothing into the clinical record:
the practitioner decides what goes there.

The organization also writes when it changes an appointment itself: when staff
move or cancel it, and when a time off or a closure sends their appointments to
the "to reschedule" list, unless whoever entered it chose not to tell them. The
message says what happened and, where the appointment still needs a time, invites
a reply, such as `Tuvimos que mover tu turno del jueves con la Dra. X. Respondé
este mensaje y buscamos otro horario.` The assistant then offers times, except for
a cancelled appointment: until booking arrives, in the second release, a reply
asking for another time is handed off.

## When Meta limits the number

Meta can restrict or rate-limit the organization's number, reject a template, or
move an approved one to another category. The admins are warned at once, in the
app and on Telegram, with what is affected and how many messages are waiting.
Nothing goes by another channel instead: the messages wait, and go out once the
number or the template is usable again, less those no longer true:

- anything about an appointment that has since started, been cancelled or been
  moved, which gets the message for its current state instead, if any;
- a reminder that a later reminder for the same appointment overtook, of which
  only the latest goes.

Care instructions and follow-ups are about an appointment that already took place,
so they still go, however late. A reply whose conversation window closed meanwhile
cannot go as it is: a person's waits behind the reopen template
([assistant.md](./assistant.md#handoff)); the assistant's is dropped and the
conversation handed off.

## To staff

Every event that staff act on is a notification in the app, read or unread:
confirmations, cancellations, reschedules, requests to approve, handoffs, replies
not delivered because the patient never answered, warnings about the WhatsApp
number, and replies that look like opt-outs. Reception sees all of them, a
clinical handoff only as existing ([assistant.md](./assistant.md#handoff)); a
practitioner sees those about their own appointments and the handoffs sent to
them. The app holds the full
record, so a failed external delivery loses nothing.

A practitioner can link Telegram from their profile, through the bot's start link.
They then get a Telegram copy of every cancellation and reschedule of their
appointments, whoever made it: the patient, reception or a closure. They can mute
it, or limit it to appointments in the next few days. Telegram is a third party,
and a dental appointment is health data (Ley 25.326), so each delivery there
carries only what its work needs:

- a cancellation or reschedule: the patient's name and the old and new times;
- a request to approve: the patient's name, the medical service and the time;
- a handoff: the patient's own words, because the reply is written there
  ([ADR-0007](../adr/0007-patients-words-on-telegram.md)).

Every message, to patients or staff, is queued in the same transaction that
changes the appointment.
