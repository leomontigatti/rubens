# Messages

## To patients

Messages go by WhatsApp to patients with WhatsApp consent; a patient without it
gets none. There is no email to patients for now. WhatsApp goes through the organization's own
number ([ADR-0006](../adr/0006-patient-assistant-on-whatsapp.md)).

The assistant words each WhatsApp message the organization starts, under the
communication rules, so no two read the same. Rubens gives it the facts (the
date, the time, the practitioner, the office, a link) and checks that each one
appears exactly; when one does not, or the model is unavailable, the message's
fixed text goes instead ([whatsapp-templates.md](../operations/whatsapp-templates.md)).
Messages carry no buttons: the patient answers
in their own words, and the assistant reads the answer
([assistant.md](./assistant.md)).

Messages the organization starts go only to patients who booked with it, are
spread out rather than sent at once, and stop for a patient who asks to stop. The
booking confirmation asks the patient to save the number.

## While the WhatsApp connection is down

The organization's WhatsApp connection is down when the linked device was logged
out from the phone, WhatsApp restricted the number, or the phone stayed offline
too long. Nothing goes by another channel instead: the admins are warned at once,
in the app and on Telegram, with how many messages are waiting and a prompt to
link the number again ([assistant.md](./assistant.md#the-number)). The warning
stays until it is linked.

Messages that come due meanwhile wait. Once the number is linked again, the
waiting messages go out, spread out like any others, except those no longer
true:

- anything about an appointment that has since been cancelled or moved, which
  gets the message for its current state instead, if any;
- a reminder whose appointment has started, or that a later reminder for the same
  appointment overtook, of which only the latest goes.

Care instructions and follow-ups still go, however late.

Messages patients sent while it was down reach the phone, not Rubens, so the
assistant does not answer them late: a person does, from the phone.

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
  reschedule it themselves.

An answer to a reminder that asks for confirmation can:

- **confirm**, which sets the appointment to confirmed;
- **cancel**, which cancels it, by the patient, and frees the time;
- **ask to reschedule**, which the assistant handles under the reschedule link's
  rules, offering times or the link.

An answer to a follow-up is only sorted: plainly good gets a thank-you; anything
else is handed off to the practitioner; an emergency gets the fixed emergency
reply. The assistant gives no advice, and writes nothing into the clinical record:
the practitioner decides what goes there.

The organization also writes when it changes an appointment itself: when staff
move or cancel it, and when a time off or a closure sends their appointments to
the "to reschedule" list, unless whoever entered it chose not to tell them. The message says what happened, and
offers the reschedule link where the appointment still needs a time.

## The reschedule link

A personal, signed link for one appointment, valid until the appointment starts.
Its page shows the free times of the same practitioner and medical service, at
any office where the practitioner works, over the next few weeks. On it the
patient can:

- **pick a new time**, which moves the appointment and frees the old time;
- **cancel** the appointment, when no time suits them;
- **ask to be contacted** (`Necesito que se comuniquen conmigo`), which gives
  reception a contact request.

Moving is allowed until the medical service's cutoff, and once per appointment,
whether through the link or the assistant. A move the organization caused, by
moving the appointment itself or by putting it on the "to reschedule" list, does
not use up that one move. Later changes go through a person. The cutoff leaves
time to fill a freed slot; the once-only rule stops a patient from pushing an
appointment back forever. Cancelling and asking for contact stay open until the
appointment starts.

## To staff

Every event that staff act on is a notification in the app, read or unread:
confirmations, cancellations, reschedules, requests to approve, handoffs, contact
requests, and replies that look like opt-outs. Reception sees all of them, a
clinical handoff only as existing ([assistant.md](./assistant.md#handoff)); a
practitioner sees those about their own appointments. The app holds the full
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
