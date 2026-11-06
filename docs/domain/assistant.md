# Assistant

The assistant answers patients on the organization's WhatsApp number, and
practitioners on Telegram. It writes the way the organization writes, under its
communication rules. It never claims to be a person; asked whether it is a bot,
it says yes. It does not introduce itself as one unprompted. Why the channel is
what it is: [ADR-0010](../adr/0010-whatsapp-cloud-api-number-per-organization.md);
why the model works through proposals: [ADR-0006](../adr/0006-patient-assistant-on-whatsapp.md).

## The number

Each organization gets a new WhatsApp number, used only through Rubens, on Meta's
official Cloud API. There is no phone and no WhatsApp app on it: every reply a
person writes goes through Rubens, from the inbox or from Telegram.

An admin connects it from the WhatsApp settings, through Meta's signup. The
organization owns its WhatsApp Business account and the number, adds its own
payment method, and Meta bills it for its messages. The settings show the
connection, the number's messaging limit and each template's approval
([messages.md](./messages.md#when-meta-limits-the-number)).

## For patients

In the first release:

- **Replies** to the messages the organization sends: confirming an appointment,
  answering a follow-up. The model reads every reply, a plain `sí` included.
- **Cancelling and moving** an appointment the patient already has
  ([below](#cancelling-and-moving)).
- **Simple questions about an existing appointment**: when, where, with whom.

In the second release:

- **Information.** Medical services, their duration and price, the insurers each
  practitioner accepts, the offices and their addresses, which practitioner works
  where and when (from their schedules: offices have no opening hours), and
  availability. It answers only from the organization's data. What the data does
  not say, it does not guess: it says it does not know and offers a person.
- **Booking.** A patient can book any active medical service of any practitioner,
  at a time from availability. The assistant asks for a preferred day and time
  before offering any, and offers the few nearest to it. Overbookings are never
  offered. A medical service that requires approval books a request instead
  ([appointments.md](./appointments.md#requests)). An unknown number can book: the
  patient is registered as incomplete, with the name they give and the number, and
  their WhatsApp consent recorded as given to the assistant.

Patients write in their own words; there are no buttons. A voice note is
transcribed and read like text; one that cannot be understood gets a request to
write it, then a handoff. Voice notes are in the first release only if
transcription passes the evaluation set on Argentine Spanish. The assistant
replies in text only, never with a voice note.

The patient is identified by the WhatsApp number. A number is the contact of
every patient whose messages go to it, the patient's own or a guardian's
([patients.md](./patients.md#guardians)), so it can stand for several patients;
the assistant asks which one before acting. The assistant never tells a number
anything about a patient who is not theirs, and never anything clinical.

## Cancelling and moving

Rescheduling happens only in the conversation. The assistant offers the free
times of the same practitioner and medical service, at any office where the
practitioner works, over the next few weeks, and moves the appointment on the
patient's yes, freeing the old time.

- **Moving** is allowed until the medical service's cutoff, and once per
  appointment. A move the organization caused, by moving the appointment itself
  or by putting it on the "to reschedule" list, does not use up that one move. The
  cutoff leaves time to fill a freed slot; the once-only rule stops a patient from
  pushing an appointment back forever.
- **Cancelling** is open until the appointment starts.
- A move past the cutoff, after the one move, or a patient who asks to be
  contacted, is handed off.

## For practitioners

A practitioner who linked Telegram can ask the assistant there, with the same
permissions as in the app:

- **Their agenda and their availability**, such as tomorrow's appointments or the
  free times on Thursday. Patients appear by name and time, nothing clinical.
- **Their time off.** Once it is confirmed, the affected appointments go on the
  "to reschedule" list, and each affected patient is told unless the practitioner
  chooses not to ([scheduling.md](./scheduling.md#time-off-and-closures)).
- **Their medical services**: reading them, and changing the duration, the price,
  the accepted insurers and the text for patients. Anything else is done in the app.
- **Requests** for medical services that require approval: approve, reject, or
  propose another time.

## Proposals

The assistant changes nothing on its own judgment. Every change is a proposal
stated in full (the appointment, the practitioner, the date and the time), which
the patient or the practitioner accepts. Only a conversation's latest proposal
can be accepted, and it expires. Accepting runs the change with the app's own
rules, so it can still fail, for example when the time was taken meanwhile; the
assistant then says so and offers others.

An explicit request is its own acceptance: `cancelalo`, `sí, voy`. An ambiguous
one gets one plain question back: `no voy a poder` is asked whether to cancel or
to move the appointment.

## Rules it always keeps

No organization can edit or override these:

- It never invents availability, prices, insurers or anything else the data does
  not hold.
- It never gives clinical advice. A message that reads as an emergency gets a
  fixed reply with the organization's phone and the emergency number, and a
  handoff.
- It changes things only through accepted proposals.
- It says it is a bot when asked.
- It reads nothing clinical: its tools return no clinical record, note or
  attachment, so it cannot pass one on.
- Every reply is checked before it goes out. One that says anything clinical
  (advice, a diagnosis, a symptom, a treatment), or anything about a patient other
  than the number's own, is held
  unsent, and the conversation is handed off. The held reply is shown only in the
  app, for the person to send, fix or drop; Telegram gets the handoff without it.
- Clinical details a patient sends (symptoms, a study, a photo) are not answered:
  they are handed off to the practitioner.

## The conversation window

The patient's message opens the customer service window, for 24 hours, and each
later message from the patient restarts it. A template the organization sends does
not open it. Inside the window the assistant and staff write freely; outside it,
Rubens can send only an approved template ([messages.md](./messages.md#to-patients)).

When the model is unavailable, an incoming message is kept and retried while the
window is open. If it still cannot be read, it is handed to a person well before
the window closes, as a clinical handoff, since nobody knows yet what it says. No
code reads it in the model's place.

## Inbox

Every conversation is in the app's inbox. Reception and admins read all of them; a
practitioner reads those about their own appointments and those handed to them.
The assistant judges every message a patient sends, also while a person holds the
conversation. A message judged clinical, the patient's or a held reply, is left out
of every conversation shown to someone who is not a practitioner who keeps
clinical records, in the app and on Telegram. A message not judged yet, because
the model is unavailable, is left out the same way until it is; in its place, the
conversation shows that a message is waiting to be read.

Anyone allowed to read a conversation can take it over at any time, not only on a
handoff. While a person holds a conversation, the assistant stays silent in it. It
takes the conversation back when the person returns it, or after a time the admin
sets. Its message on taking the conversation back goes out only inside the window;
outside it, the assistant takes the conversation back without a word. A handoff
nobody answered stays open either way ([below](#handoff)).

## Handoff

The assistant hands a conversation to a person when:

- the patient asks for one, or to be contacted;
- a rule refuses what the patient wants (past the cutoff, the one move used);
- the question is clinical, or a follow-up's answer is not plainly good;
- it has misunderstood the patient twice in a row;
- a voice note stays unintelligible;
- the model could not read a message well before the window closes.

The handoff goes to the practitioner of the appointment it concerns, and
otherwise to the organization's handoff contacts, members an admin picks. At
least one of them is a practitioner who keeps clinical records: the last such
contact can neither be removed nor deactivated, as the last admin
([access.md](./access.md)). A clinical handoff (a clinical question, a
follow-up's answer, clinical details, a held reply) goes only to a practitioner
who keeps clinical records: the appointment's, else those among the handoff
contacts. Anyone else, reception included, sees that it exists, never its words.
The handoff arrives on Telegram with the patient's own words
([ADR-0007](../adr/0007-patients-words-on-telegram.md)) and in the inbox. The
person replies in Telegram or in the app, and the reply reaches the patient on
WhatsApp under their name.

A handoff counts back from the window's close. Its recipient is told at once,
reminded about 6 hours before the close, and about 2 hours before it the reminder
also goes to every other member who may answer it (for a clinical handoff, only
practitioners who keep clinical records). An admin can move these times, but none
can fall after the close. The patient's `your answer is on its way` message goes out
only inside the window. A handoff made after the close, for a reply that could not
go out in time, has no countdown and tells the patient nothing: its recipient is
told at once, and their reply goes through the reopen template.

A handoff is open until a person's reply reaches the patient, or a person closes it
without a reply when nothing is left to answer. Whether its notification was read
does not matter, and going back to the assistant does not close it. The inbox lists
open handoffs.

A reply a person writes after the window closed is stored, and the patient gets
the reopen template (`Tenemos una respuesta para vos, respondé este mensaje para
verla`). The reply goes out when the patient answers. If they never do, the person
is told it was not delivered. The reply itself never goes into a template.

## Pace

The assistant answers when the patient stops writing, a few seconds after their
last message, so three short messages in a row get one reply. It shows typing
while the reply is written out, for about as long as a person would take.

A longer reply goes out as a few short messages, the way people write on
WhatsApp, each after its own typing; never more than three. Each one is billed by
Meta, so splitting a reply multiplies its cost ([costs](#costs)). A proposal is
never split: it stays whole in one message, so what the patient accepts is what
they read. An organization's communication rule can ask for one message instead.

## Communication rules

How the assistant writes is set in three layers, the higher one winning:

1. **Its own rules**, above. Nobody edits them.
2. **The organization's**, set by admins: tone, `vos` or `usted`, how to sign off.
3. **A practitioner's**, set by that practitioner, for conversations about their
   appointments: how to name them, for example.

A rule is either written in words, which the assistant follows as an instruction,
or one of a few checks applied to every reply, which always hold: no opening `¿`
and `¡`, no emojis, a maximum length. A rule can change how the assistant writes,
never what it may do.

Staff can correct a reply the assistant sent, or mark one as good; it becomes a
reply example, which the assistant imitates. Examples belong to the organization
or to a practitioner, like rules.

The number of rules and their length are limited. Every change is audited, and
each reply records the version of the rules it was written under.

Rules do not reach the templates: those are fixed once Meta approves them, so the
organization's voice is written into each template when it is submitted
([whatsapp-templates.md](../operations/whatsapp-templates.md)).

## Trying it

The WhatsApp settings have a place to try the assistant before patients meet it.

- **Template preview** (first release): each template as WhatsApp bubbles, filled
  with a sample appointment, with its approval status at Meta and the reason for a
  rejection, checks against Meta's rules before it is submitted, and its approved
  versions side by side.
- **Sandbox** (first release): staff play the patient against the real assistant,
  with its real tools and the real agenda, starting from a scenario. It shows the
  tool calls, the proposals, whether the clinical check would hold a reply, the
  window's countdown and the number of messages. It runs the organization's real
  object methods with their writes discarded, so it never writes, never reaches
  WhatsApp, is rate-limited, and counts in the
  organization's use. A rule's author tries a change here before saving it.
- **Saved scenarios** (second release): sandbox conversations run again on every
  change to the rules or the model, with the differences shown, as a Cloudflare
  Workflow since a run exceeds one request's CPU limit. They are also the set the
  model is chosen by.

## Costs

Each organization pays for what its assistant uses. Meta bills the organization
directly for its WhatsApp messages: each template, and each message inside a window
past the number's free ones of the month. Rubens records the rest per organization:
voice transcription and the model's replies, sandbox use included. Rates and an
example month: [whatsapp-assistant.md](../research/whatsapp-assistant.md#cost-example).
