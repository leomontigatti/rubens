# Assistant

The assistant answers patients on the organization's own WhatsApp number, and
practitioners on Telegram. It writes the way the organization writes, under its
communication rules. It never claims to be a person; asked whether it is a bot,
it says yes. It does not introduce itself as one unprompted. Why the channel and
the model are what they are: [ADR-0006](../adr/0006-patient-assistant-on-whatsapp.md).

## The number

An admin links the organization's WhatsApp number from its settings, by scanning
a QR code with the phone, after being told that this is not Meta's official
channel and that WhatsApp can restrict or ban a number for it. The number stays
in the phone's WhatsApp app. The settings show whether it is connected; when it
is down, the admins are warned at once, in the app and on Telegram, and an admin
links it again from the same place
([messages.md](./messages.md#while-the-whatsapp-connection-is-down)).

## For patients

- **Information.** Medical services, their duration and price, the insurers each
  practitioner accepts, the offices and their addresses, which practitioner works
  where and when (from their schedules: offices have no opening hours), and
  availability. It answers only from the organization's data. What the data does
  not say, it does not guess: it says it does not know and offers a person.
- **Booking.** A patient can book any active medical service of any practitioner,
  at a time from availability. The assistant asks for a preferred day and time
  before offering any, and offers the few nearest to it. Overbookings are never
  offered. A medical service
  that requires approval books a request instead
  ([appointments.md](./appointments.md#requests)).
- **Cancelling and rescheduling** their own appointments, under the reschedule
  link's rules ([messages.md](./messages.md#the-reschedule-link)): cancelling is
  open until the appointment starts; moving, until the medical service's cutoff
  and once per appointment. A move past the cutoff, or after the one move, it
  hands off.
- **Replies** to the messages the organization sends: a reminder's confirmation,
  a follow-up's answer. Patients write in their own words, by text or voice note;
  there are no buttons. A voice note is transcribed and read like text; one that
  cannot be understood gets a request to write it, then a handoff.

The patient is identified by the WhatsApp number. A number is the contact of
every patient whose messages go to it, the patient's own or a guardian's
([patients.md](./patients.md#guardians)), so it can stand for several patients;
the assistant asks which one before acting. An unknown number can ask and book:
at booking, the patient is registered as incomplete, with the name they give and
the number, and their WhatsApp consent recorded as given to the assistant. The assistant never tells a number anything about a patient who is
not theirs, and never anything clinical.

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

## Handoff

The assistant hands a conversation to a person when:

- the patient asks for one;
- a rule refuses what the patient wants (past the cutoff, the one move used);
- the question is clinical, or a follow-up's answer is not plainly good;
- it has misunderstood the patient twice in a row;
- a voice note stays unintelligible.

The handoff goes to the practitioner of the appointment it concerns, and
otherwise to the organization's handoff contacts, members an admin picks, at
least one of them a practitioner. A
clinical handoff (a clinical question, a follow-up's answer, clinical details, a
held reply) goes only to a practitioner: the appointment's, else the handoff
contacts who are practitioners. Anyone else, reception included, sees that it
exists, never its words. The
handoff arrives on Telegram with the patient's own words
([ADR-0007](../adr/0007-patients-words-on-telegram.md)) and as a notification in
the app. The person replies in Telegram, or in the app, and the reply reaches the
patient on WhatsApp under their name.

The app's view is the fallback for whoever has no Telegram linked or cannot reach
it: the open handoffs and requests, each with its conversation and a reply box.

A message the assistant judged clinical, the patient's or a held reply, is left
out of every conversation shown to someone who is not a practitioner, in the app
and on Telegram, later handoffs included. The organization's phone still shows
the whole conversation, as WhatsApp does; whoever holds it reads everything.
It has no assigning, no labels and no notifications of its own beyond the
existing ones.

A handoff nobody answers is not lost: its recipient is reminded after a time the
admin sets, and again before the conversation goes back to the assistant, and the
patient is told the answer is on its way. When it does go back unanswered, the
assistant tells the patient and the handoff stays as an unread notification.

While a person holds the conversation, the assistant stays silent in it. It takes
the conversation back when the person returns it, or after a time the admin sets.
Someone who writes to the patient from the organization's phone holds the
conversation the same way, as if it had been handed to them. Rubens tells such
a message from its own by the messages it sent itself.

## Pace

The assistant answers when the patient stops writing, a few seconds after their
last message, so three short messages in a row get one reply. It shows typing
while the reply is written out, for about as long as a person would take.

A longer reply goes out as a few short messages, the way people write on
WhatsApp, each after its own typing; never more than three. A proposal is never
split: it stays whole in one message, so what the patient accepts is what they
read. An organization's communication rule can ask for one message instead.

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

Before saving a change, its author can try a patient's message against the new
rules and see the reply. The number of rules and their length are limited. Every
change is audited, and each reply records the version of the rules it was written
under.

The rules also reach the messages the organization starts, which the assistant
words ([messages.md](./messages.md#to-patients)), but not their fixed texts.

## Costs

Each organization pays for what its assistant uses: voice transcription and the
model's replies. WhatsApp messages cost nothing per message. Rubens records that
use per organization.
