# Messages

## To patients

Messages go by WhatsApp to patients with WhatsApp consent; a patient without it
gets none. There is no email to patients for now. WhatsApp goes through the
organization's number on Meta's Cloud API
([ADR-0010](../adr/0010-whatsapp-cloud-api-number-per-organization.md)).

Every message the organization starts is a template Meta approved for the
organization, in its own voice: the drafts are in
[whatsapp-templates.md](../operations/whatsapp-templates.md). underthing fills in its
facts (the date, the time, the practitioner, the office). Templates carry no
buttons: the patient answers in their own words, and the assistant reads the
answer ([assistant.md](./assistant.md)). The patient's answer opens the
conversation window ([assistant.md](./assistant.md#the-conversation-window)).

Messages the organization starts go only to patients who booked with it, and stop
for a patient who asks to stop.

### The organization's templates

An admin creates, names and edits the organization's templates; no other role
does. Each has:

- **Its name** (`Nombre`), which the organization's templates do not share.
- **Its text** (`Texto`), checked against Meta's rules and the assistant's fixed
  checks (no opening `¿` or `¡`, no emojis) before it is submitted. It may use every
  fact of the appointment and the organization's name. Care instructions, or what
  to bring, are written into the text of the template that carries them.
- **When it is sent** (`Cuándo se envía`): when the appointment is booked (or the
  request approved), when it is marked attended, or a number of hours or days
  before or after the appointment, up to 30 days. Before counts from the
  appointment's start, after from its end. This is underthing's setting, not
  Meta's: changing it, or the name, submits nothing and needs no new approval.

The text says what the message is about and the appointment's date and time,
never when it is sent: a message held back by Meta goes late, and `mañana` or
`en 2 horas` would then be wrong. For the same reason it greets with `Hola`, never
by the time of day. It names the organization instead of signing off.

Every organization starts with four drafts, worded in its `Trato` as the
communication rules have it when they are created
([whatsapp-templates.md](../operations/whatsapp-templates.md)). Changing `Trato`
later changes no template's text.

An admin can delete a template that was never sent to Meta and that no medical
service picks; any other stays. Every change to a template is audited, with what it was
and what it became: its creation, a new name, text or timing, each text sent to
Meta, and its deletion.

A medical service picks which of the organization's templates its appointments
get, each once, and at most five reminders among them; several may share a timing.
Its form offers the ones Meta approved, and keeps one it already picks. A template no
medical service picks is sent to nobody. A medical service also sets **the
reschedule cutoff**: how long before the appointment the patient can still move
it through the assistant ([assistant.md](./assistant.md#cancelling-and-moving)).

A template sends nothing until Meta approves one of its versions. From then on
its messages are queued as their appointments come to their timing:

- **when booked**: at the booking, or at the approval of a request;
- **before the appointment**: at the booking, each for its time. One whose time
  has already passed is skipped, not sent late. A request gets none until it is
  approved; the same rule then applies from the approval;
- **when marked attended**: at once, when the appointment is marked attended;
- **after the appointment**: when it is marked attended, for its time after the
  appointment's end. An appointment never marked attended gets none.

Undoing "attended" drops the last two kinds of message still queued.

**Rebuilding.** When an admin changes a template's timing, Meta approves a
template, or a medical service changes the templates it picks, the messages
still ahead for that template's, or that medical service's, booked and confirmed
appointments are dropped and queued again for their times, as a move of the
appointment does. A timing change or an approval leaves a message already due and
waiting as it is; a template a medical service stops picking, or one deleted, drops
its messages, due ones included
([below](#when-meta-limits-the-number)). This is also
how an organization that sets up its templates after appointments are booked
still reaches them: nothing about a booking already made goes, only what is
still ahead of it.

A reply to any message can:

- **confirm**, which sets the appointment to confirmed;
- **cancel**, which cancels it, by the patient, and frees the time;
- **ask to reschedule**, which the assistant handles in the conversation, offering
  times ([assistant.md](./assistant.md#cancelling-and-moving)).

Which it does is the assistant's reading of the reply against the message it
answers: no template is marked as asking to confirm.

An answer to a message that asks how the patient feels is only sorted: plainly
good gets a thank-you; anything else is handed off to the practitioner; an
emergency gets the fixed emergency reply. The assistant gives no advice, and
writes nothing into the clinical record: the practitioner decides what goes
there.

### The event templates

Five templates are fixed and sent on their event, never picked by a medical
service, never named or timed by an admin: `turno_movido`, `turno_cancelado`,
`turno_a_reprogramar`, `solicitud_no_confirmada` and `reabrir_conversacion`
([whatsapp-templates.md](../operations/whatsapp-templates.md#event-templates)).
An admin writes and submits their text as for the others.

The organization also writes when it changes an appointment itself: when staff
move or cancel it, and when time off, a closure or a schedule change sends their
appointments to the "to reschedule" list, unless whoever saved the time off or
the closure, asked on saving, chose not to tell them. Only the message for the latest change goes.
No message timed before the appointment goes while it is on the list, told or
not. The message
says what happened and, where the appointment still needs a time, invites
a reply, such as `Tuvimos que mover tu turno del jueves con la Dra. X. Respondé
este mensaje y buscamos otro horario.` The assistant then offers times, except for
a cancelled appointment: until booking arrives, in the second release, a reply
asking for another time is handed off.

## When Meta limits the number

Meta can restrict or rate-limit the organization's number, reject a template, or
move an approved one to another category. The admins are warned at once, in the
app and on Telegram, with what is affected and how many messages are waiting.
Nothing goes by another channel instead: the messages wait, and go out once the
number or the template is usable again, less those no longer true, which are
dropped:

- anything about an appointment that has since started, been cancelled or been
  moved, which gets the message for its current state instead, if any;
- anything to a patient whose WhatsApp consent was turned off;
- a message whose template its medical service no longer picks, or which was
  deleted: an admin took it away on purpose;
- a message sent when the appointment is marked attended or after it, once that
  is undone.

Several late messages of one appointment each go, in the order of their times:
their texts name the date and time, not how far off it is. Messages sent when the
appointment is marked attended or after it are about an appointment that already
took place, so they still go, however late.

A reply whose conversation window closed meanwhile cannot go as it is: a person's waits behind the reopen template
([assistant.md](./assistant.md#handoff)); the assistant's is dropped and the
conversation handed off.

## To staff

Every event that staff act on is a notification in the app, read or unread:
confirmations, cancellations, reschedules, requests to approve, handoffs, replies
not delivered because the patient never answered, warnings about the WhatsApp
number, and replies that look like opt-outs. Reception sees all of them; a
practitioner sees those about their own appointments and the handoffs sent to
them. A handoff's notification says why, so its reader can answer without
reading the conversation back ([assistant.md](./assistant.md#handoff)). The app holds the full
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
