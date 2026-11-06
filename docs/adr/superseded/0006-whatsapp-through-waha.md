# ADR-0006, channel sections: the organization's own number through WAHA

**Status**: superseded by [ADR-0010](../0010-whatsapp-cloud-api-number-per-organization.md)
on 2026-11-06. The rest of [ADR-0006](../0006-patient-assistant-on-whatsapp.md) is
live. Kept for its rationale.

Amended 2026-11-06 (#125), before it was superseded: after the port to Workers
([ADR-0008](../0008-cloudflare-workers-one-object-per-organization.md)), there is no VPS
beside the app and no pg-boss. Where WAHA runs (it needs an always-on process) and what
replaces the pg-boss worker were left open.

## The organization's own number, through WAHA

Each organization links the number it already has, from its settings in Rubens,
by scanning a QR code with the phone, as WhatsApp Web is linked. The number stays
in the WhatsApp app, so reception can keep answering from the phone. Rubens
connects through [WAHA](https://waha.devlike.pro/), a self-hosted gateway that
speaks WhatsApp Web's protocol, run as one container beside the app with a
session per organization. Its free edition holds many sessions and media since
2026.6.1.

The business chose it over Meta's Cloud API, knowing the risk. It needs no
templates approved in advance, costs nothing per message, has no 24-hour window,
and sends real voice notes. In exchange it breaks WhatsApp's terms, which forbid
unofficial clients, and a number can be restricted or banned for it, even on first
connecting, with appeals that take weeks. No public evidence gives a safe volume or
a behaviour that prevents it.

WAHA sits behind a channel layer of Rubens' own: send text, send a voice note,
show typing, mark read, receive. The layer maps each organization to its session,
stores every message once (by its WhatsApp id) before acting on it, and retries
sends. WAHA runs on whatsmeow or Baileys underneath, picked in its configuration,
so a WhatsApp change that breaks one library is waited out on the other. Its
version is pinned, and its webhook is signed and reachable only from the app.

Starting small, Meta's Cloud API is not built. It is the second implementation the
channel layer leaves room for, if restrictions prove common or an organization
wants the official channel.

## Behaving like a person's number

The precautions follow the reasons WhatsApp's servers give for restricting a
number: the same text to many people, messages to people who have not saved the
number, and blocks or reports.

- Rubens starts messages only to patients who booked an appointment, and
  otherwise only replies. It never messages a list.
- The booking confirmation asks the patient to save the number.
- No two messages are the same text: the assistant writes each one
  ([messages.md](../domain/messages.md#to-patients)).
- A patient who asks to stop gets nothing more that Rubens starts.
- Messages Rubens starts are spread out, never sent in a burst.
- A reply waits until the patient stops writing, then shows typing for about as
  long as the reply takes to type. That is for the conversation to read as human;
  there is no evidence it prevents a ban.

When a session is logged out or restricted, the admins are told at once, in the
app and on Telegram, and messages wait in the queue instead of failing silently.
Nothing falls back to another channel.

## The model words the messages Rubens starts

The model also words the messages Rubens starts, such as reminders, from the facts
Rubens gives it. The code checks that each fact (the date, the time, the
practitioner, the office, a link) appears exactly as given, and sends the fixed
text instead when it does not, or when the model is unavailable.

## In a pg-boss worker

The webhook only stores the event and queues it, in one transaction; a pg-boss
worker transcribes, calls the model and replies.

## Considered and rejected

- **Meta's Cloud API, for now.** Templates approved in advance for every message
  Rubens starts, a fee per template, a 24-hour window for free text, and Meta's
  restriction on general-purpose AI assistants to stay clear of. It is deferred,
  not rejected: the channel layer keeps the way open.
- **Rubens' own client on Baileys or whatsmeow.** Not fewer dependencies: the
  protocol still comes from the library. Rubens would own the sessions'
  reconnection and storage, and be tied to one library through its breakages, as
  Baileys' months-long parsing regression fixed in May 2026.

## Consequences

- A restricted number stops the assistant and the reminders for that organization
  until it is linked again. What came due meanwhile then goes out, less what is
  no longer true.
- Rubens offers software against WhatsApp's terms, which name third-party software
  that reproduces the service, so the risk is Rubens' as a vendor, not only the
  organization's. An organization is told so before it links its number.
- A WhatsApp change can stop every organization at once until an engine is fixed
  or switched. WAHA's releases are watched like a dependency's.
- Whoever holds the organization's phone reads every conversation, clinical
  messages included: Rubens keeps clinical words from reception in the app and on
  Telegram, but cannot reach the phone's WhatsApp.
- WAHA holds each number's session keys, which are as sensitive as the phone
  itself: its storage is a secret, backed up and restored like the database.
