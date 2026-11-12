# Assistant

The assistant answers patients on the organization's WhatsApp number, and
practitioners on Telegram. It writes the way the organization writes, under its
communication rules. It never claims to be a person; asked whether it is a bot,
it says yes. It does not introduce itself as one unprompted. Why the channel is
what it is: [ADR-0010](../adr/0010-whatsapp-cloud-api-number-per-organization.md);
why the model works through proposals: [ADR-0006](../adr/0006-patient-assistant-on-whatsapp.md).

## The number

Each organization gets a new WhatsApp number, used only through underthing, on Meta's
official Cloud API. There is no phone and no WhatsApp app on it: every reply a
person writes goes through underthing, from the inbox or from Telegram.

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
- **Asking to stop**: a reply that looks like an opt-out gets a fixed answer that
  the team is told, and reaches reception and the admins as a notification, one
  per patient of the number who still accepts WhatsApp, for a person to turn
  their consent off or keep it under the reply in the conversation, and holds what the organization starts to them
  until then ([patients.md](./patients.md#whatsapp-consent)). It is not a
  handoff, unless the reply is a health question too, or the number reaches no
  patient by the time the turn settles.

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
transcribed and read like text, and the inbox shows its transcript as the
patient's words; one that cannot be understood gets a request to write it, and a
second misunderstanding in a row is handed off. Transcription is Whisper on
Workers AI, chosen by the evaluation set on Argentine Spanish. The assistant
replies in text only, never with a voice note.

The patient is identified by the WhatsApp number. A number is the contact of
every patient whose messages go to it, the patient's own or a guardian's
([patients.md](./patients.md#guardians)), so it can stand for several patients;
the assistant asks which one before acting. The assistant never tells a number
anything about a patient who is not theirs, and never anything clinical.

Each turn judges only what it can see, and underthing decides who answers. The
model judges whether the patient's new messages are a health question:
symptoms, care, a medicine or a treatment, how they are after a procedure in an
answer that is not plainly good. A symptom given only as the reason for another
request (`un turno porque me duele una muela`) is not one: the request is the
assistant's. A clinic can have several specialties, so the model also names the
upcoming appointment whose medical service and practitioner's specialty cover
the question, if any. A health question goes to that appointment's
practitioner, and otherwise to reception. An emergency always needs the
practitioner, whatever the model said of it.

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
- **Cancelling** is open until the appointment starts, and notifies reception and the
  admins ([messages.md](./messages.md#to-staff)).
- A move past the cutoff, after the one move, or a patient who asks to be
  contacted, is handed off, and the patient is told nothing about it
  ([Handoff](#handoff)).
- **A 👍 or ✅** is the patient's yes, the same as `sí`, to the conversation's latest
  proposal or to a reminder that asks them to confirm, as a reaction to that message
  or as a message holding only that emoji right after it ([Proposals](#proposals)).

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

A patient can also react to a message, as WhatsApp lets them. The model reads a
reaction with the words of the message it reacts to. A 👍 or ✅ on the message that
states the latest proposal, or a message holding only that emoji after it, accepts
the proposal under the same rules as `sí`: in a later message, before it expires,
and while the appointment is as stated. On a reminder that asks the patient to
confirm, or right after it, it confirms the appointment the way `sí, voy` to that
reminder does: proposed and accepted in the same turn, only while that reminder
is the practice's latest message and the appointment is not confirmed yet. The model tells a reminder
that asks to confirm by its words, as it does for `sí`. A reaction to any other
message, a reminder that does not ask included, or with another emoji, is not a
request: it changes nothing. A reaction the patient
replaces is read no more, and one they take back is ignored: it starts no turn,
and the model does not read the reaction it removed, nor accepts on it while a
turn that read it is still running.

## Rules it always keeps

No organization can edit or override these:

- It never invents availability, prices, insurers or anything else the data does
  not hold.
- It never gives clinical advice. A message that reads as an emergency gets a
  fixed reply with the emergency number (107) and the organization's phone, which
  an admin sets with the communication rules, and a handoff to the practitioner.
  That reply always goes, while a handoff is open or a person holds the
  conversation too; the holder then gets an urgent notification.
- It changes things only through accepted proposals.
- It says it is a bot when asked.
- It reads nothing clinical: its tools return no clinical record, note or
  attachment, so it cannot pass one on.
- Every reply is checked before it goes out. One that says anything clinical
  (advice, a diagnosis, a symptom, a treatment), or anything about a patient other
  than the number's own, is held
  unsent, and the conversation is handed to the practitioner. A reply that could
  not be checked is held the same way. The held reply is shown in the app to
  everyone who reads the conversation; only a practitioner who keeps clinical
  records sends or fixes it, and anyone who reads it drops it. Telegram gets the
  handoff without it. The check is a model call of its own that reads the reply
  alone, never the conversation.
- A health question is not answered: it is handed off, to the practitioner who
  treats it or to reception. A photo, a
  video or a file never reaches the model: it goes to reception as an ordinary
  handoff, and reception passes it to the practitioner when it needs one.

## The conversation window

The patient's message opens the customer service window, for 24 hours, and each
later message from the patient restarts it, a reaction included; a reaction
taken back does not. A template the organization sends does
not open it. Inside the window the assistant and staff write freely; outside it,
underthing can send only an approved template ([messages.md](./messages.md#to-patients)).

When the model is unavailable, an incoming message is kept and retried while the
window is open. If it still cannot be read, it is handed to reception well before
the window closes, and no longer retried. A message a person answers first, by
replying or by closing its handoff, is no longer retried either. No code reads it
in the model's place, and nothing is sent to the patient while it is unread.
Reception reads it, so an opt-out among such words, or one the model missed, is
reception's to act on, with the words in front of it.

## Inbox

Every conversation is in the app's inbox. Reception and admins read all of them,
every message included: the patient's, one not judged yet, a held reply and a
practitioner's reply, in the app and on Telegram
([ADR-0013](../adr/0013-reception-reads-every-conversation.md)). A practitioner
reads only the conversations handed to them, not every conversation of their
patients; the number's link to its patients still routes a handoff. What stays
with the practitioners is the clinical record ([access.md](./access.md)). The
assistant judges every message a patient sends, also while a person holds the
conversation.

A patient's reaction shows under the message it reacts to, as WhatsApp shows
it, and goes once they take it back; the list of conversations does not show it as
the latest message.

A patient's voice note, photo, video or file stays at Meta: underthing keeps the
message, and a voice note's transcript as its words, never the media. Whoever reads
the conversation opens it on demand, with `Escuchar`, `Ver foto`, `Ver video` or
`Abrir archivo`. Each press goes through underthing, which checks the same reading
rules, fetches the media from Meta by the id in the message and streams it to the
browser, never storing, caching or linking it at a public URL. Meta deletes a
patient's media seven days after it was sent: the button then gives way to
`Ya no está disponible en WhatsApp (pasaron más de 7 días)`, and the transcript
stays.

Anyone allowed to read a conversation can take it over at any time, not only on a
handoff, from whoever held it. While a person holds a conversation, the assistant
stays silent in it. The person's reply goes to the patient under their name, inside
the window. The assistant takes the conversation back when the person returns it, or
after a time the admin sets (4 hours until they do), counted from the hold or the
person's latest reply. It takes the conversation back without a word, and answers
the patient's next message. A handoff nobody answered stays open either way
([below](#handoff)).

## Handoff

The assistant hands a conversation to a person when:

- the patient asks for one, or to be contacted;
- a rule refuses what the patient wants (past the cutoff, the one move used);
- the patient wants a new time for an appointment the organization cancelled,
  until booking arrives in the second release;
- the patient asks a health question ([above](#for-patients)), or a follow-up's
  answer is not plainly good;
- it has misunderstood the patient twice in a row;
- a voice note stays unintelligible;
- the patient sent a photo, a video or a file;
- the model could not read a message well before the window closes.

A handoff that needs the practitioner (a question the practitioner of an
upcoming appointment treats, a follow-up's answer, an emergency, a held reply)
goes to the practitioner of the appointment it concerns, when they keep
clinical records, else to the handoff contacts who do,
members an admin picks, else to every active practitioner who does while none is
picked. With none of them, it goes to the active admins, words included, and
their notification says that no practitioner keeps clinical records, with a
link to the handoff contacts. Only a practitioner who keeps clinical records, or
a member it went to, answers it or closes it.

Every other handoff goes to the handoff contacts, or to every active admin while
none is picked, and not to the appointment's practitioner. That includes a health
question no upcoming appointment's practitioner treats, such as a toothache from a
patient whose appointment is a kinesiology session, or from a patient with nothing
booked: reception decides who sees it, or tells the patient to book with the right
specialist. While a handoff to the practitioner is open, a health question opens
nothing more: the practitioner has the conversation's health topic already. The
judgement opens the handoff even when the model never hands the conversation off. Roles combine on one
member, so a solo practitioner who is also the admin gets both kinds. Reception
can pass one to the practitioner (`Pasar al profesional`), which then goes where
a handoff to the practitioner goes, telling the patient nothing. At least one
handoff contact is a practitioner who keeps clinical records: the last such
contact can neither be removed nor deactivated, as the last admin
([access.md](./access.md)).

A handoff's notification says why, so its reader can answer without reading the
conversation back: `Marta Quiroga quiere pasar el turno del jueves 10:00 y falta
menos de 24 h`, and what the same turn did anyway, such as another appointment it
moved. The handoff arrives on Telegram with the patient's own words
([ADR-0007](../adr/0007-patients-words-on-telegram.md)) and in the inbox. The
person replies in Telegram or in the app, and the reply reaches the patient on
WhatsApp under their name. The reply box of a practitioner answering a handoff
says that reception reads the conversation too.

What the patient is told:

- **A handoff to the practitioner**: `Le paso tu consulta a {profesional}`, with
  the name patients read of the appointment's practitioner, or `al profesional`
  when it goes to someone else; in the organization's `Trato`.
- **Any other handoff**: nothing about what it hands off. The assistant does not
  explain a refusal, never sends the patient to another professional itself
  (`consultá con tu odontólogo`), and never says it passed anything on; a person replies, and a message unanswered overnight waits
  for office hours. When the same turn also made a change, its reply states only
  that change (`Listo, te pasé el turno del jueves al viernes 10:00`), after the
  clinical check.
- **A burst that mixes both**, such as `quería confirmar el turno del jueves` and
  `me sigue doliendo la muela`: the assistant does its part, and its reply about
  it goes after the clinical check, followed by the handoff's fixed reply
  (`Listo, confirmado el jueves.` then `Le paso tu consulta a {profesional}.`).
- **An emergency**: the emergency reply above.

While a handoff is open the assistant stays in the conversation. It answers the
new requests it can handle (confirming, cancelling, moving, when and where), told
what the open handoff is about, and does not answer that topic again: asked
about it, it says `Ya se lo pasé, te va a responder por acá.` A second handoff
of the kind already open, to the practitioner or to reception, is not opened. It
stays silent while a person holds the conversation.

A handoff counts back from the window's close. Its recipient is told at once,
reminded about 6 hours before the close, and about 2 hours before it the reminder
also goes to every other member who may answer it (for one to the practitioner,
only practitioners who keep clinical records). An admin can move these times, but none
can fall after the close. A reminder that falls between 21:00 and 08:00 in the
organization's time zone (its first office's) waits until 08:00, in the app and on
Telegram, and does not go when the window closes first: a reply after the close goes
through the reopen template. These hours are fixed; offices have no opening hours.
The notification when a handoff opens always goes at once. A handoff made after the close, for a reply that could not
go out in time, has no countdown and tells the patient nothing: its recipient is
told at once, and their reply goes through the reopen template.

A handoff is open until a person's reply reaches the patient, or a person closes it
without a reply when nothing is left to answer. A reply Meta reports as failed
never reached the patient: the handoff it closed opens again, the reply keeps
`No entregado` in the conversation, and its writer is told (`Tu respuesta a
{paciente} no se entregó`), with a link to the conversation. Whether its notification was read
does not matter, and going back to the assistant does not close it. The inbox lists
the conversations with an open handoff first, and can show only those.

A reply a person writes after the window closed is stored, and the patient gets
the reopen template (`Tenemos una respuesta para vos, respondé este mensaje para
verla`). The reply goes out when the patient answers, or writes again before the
template went; the replies written meanwhile wait behind the same template and go
in order, and the person is the conversation's holder again, since the patient
answered them. If the patient has not answered about 7 days after the reply, or
after the template when it went later, or the template could not go, the person
is told it was not delivered. Until the patient answers, the person who wrote a
reply may withdraw it: it never goes, and the template is dropped if it has not
gone and no other reply waits behind it. The conversation keeps a trace of who
withdrew a reply and when, without its words; when the template had gone, the
assistant is told the reply it announced was withdrawn. The reply itself
never goes into a template, and it needs a patient of the number who accepts
WhatsApp, whom the template greets.

## Pace

The assistant answers when the patient stops writing, a few seconds after their
last message, so three short messages in a row get one reply. It shows typing
while the reply is written out, for about as long as a person would take.

A longer reply goes out as a few short messages, the way people write on
WhatsApp, each after its own typing; never more than three. Each one is billed by
Meta, so splitting a reply multiplies its cost ([costs](#costs)). A proposal is
never split: it stays whole in one message, so what the patient accepts is what
they read. An organization's communication rule can ask for one message instead.

One conversation's typing never holds back another's reply: patients who write at
the same time are each answered after their own pauses, not one after the other's.

## Communication rules

How the assistant writes is set in three layers, the higher one winning:

1. **Its own rules**, above. Nobody edits them.
2. **The organization's**, set by admins: tone, and `vos` or `usted` (`Trato`). Replies
   carry no sign-off: the conversation is already the organization's number.
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

Rules do not reach the templates: those are fixed once Meta approves them. The
organization's default drafts are worded in its `Trato` when they are created, and
one never sent to Meta follows the `Trato` an admin later saves, audited; a template
sent to Meta, or a text the organization wrote, keeps its text whatever the `Trato`.
The template's page says which ([whatsapp-templates.md](../operations/whatsapp-templates.md)). The fixed
checks apply to templates too: a text with an opening `¿` or `¡`, or an emoji, is
refused before it goes to Meta.

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
past the number's free ones of the month. underthing records the rest per organization:
voice transcription and the model's replies, sandbox use included. Rates and an
example month: [whatsapp-assistant.md](../research/whatsapp-assistant.md#cost-example).
