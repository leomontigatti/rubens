# ADR-0006: Patients talk to an assistant on the organization's own WhatsApp number

**Status**: accepted

Date: 2026-11-04. The rules it serves are in [assistant.md](../domain/assistant.md);
the research behind it, with sources, is in
[whatsapp-assistant.md](../research/whatsapp-assistant.md).

Patients write to the number they already use, and a reception desk is what the
business wants to need less of. So each organization's number gets an assistant
that answers, books, cancels and reschedules, and hands off to a person when it
cannot.

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

## The model interprets, Rubens decides

The model reads what people write and picks among a few tools. The tools are the
app's own server functions, called with the permissions of the patient's number or
of the practitioner, so cutoffs, availability and roles come from the code, never
from the prompt. Every change is a proposal stored by Rubens; the model can only
accept the latest one, when the person said yes to it, and the change then runs
under the app's rules. The model never writes on its own.

That boundary is what allows messages without buttons. Buttons would give exact
answers, but the business wants conversations that read as human, so replies are
interpreted, and the proposal keeps an interpretation from becoming a change
nobody agreed to.

The model also words the messages Rubens starts, such as reminders, from the facts
Rubens gives it. The code checks that each fact (the date, the time, the
practitioner, the office, a link) appears exactly as given, and sends the fixed
text instead when it does not, or when the model is unavailable.

## TanStack AI, in a pg-boss worker

The webhook only stores the event and queues it, in one transaction; a pg-boss
worker transcribes, calls the model and replies. TanStack AI keeps the stack in one
ecosystem and is provider-neutral. It reached 1.0 in October 2026, so the tools
are plain functions with Zod schemas, and the library is a thin layer over them
that can be swapped for the AI SDK without touching them. The model, open-weight
ones included, is chosen by running a set of booking conversations against the
candidates, not by its price.

## Considered and rejected

- **Meta's Cloud API, for now.** Templates approved in advance for every message
  Rubens starts, a fee per template, a 24-hour window for free text, and Meta's
  restriction on general-purpose AI assistants to stay clear of. It is deferred,
  not rejected: the channel layer keeps the way open.
- **A hosted unofficial API** (Whapi.Cloud, UltraMsg, Green API, Z-API). Just as
  unofficial, a fee per number, and patients' conversations on one more company's
  servers.
- **Rubens' own client on Baileys or whatsmeow.** Not fewer dependencies: the
  protocol still comes from the library. Rubens would own the sessions'
  reconnection and storage, and be tied to one library through its breakages, as
  Baileys' months-long parsing regression fixed in May 2026.
- **A general agent** (Grok Bot, OpenClaw, CopilotKit's OpenBot). They act for one
  trusted owner, with a browser, a shell and memory. Patients are strangers whose
  words must not steer anything beyond a few narrow tools.
- **An inbox product** (Chatwoot, Tiledesk). Chatwoot's agent bots and handoff
  fit, but it is a second store of patient messages, with its own tenancy to
  secure and a server of its own. Rubens holds the conversation it already has to
  keep for the audit.
- **A flow builder** (n8n, Dify, Typebot, Flowise). Their licences restrict a
  multi-tenant product, or the project has ended, and none removes the booking rules
  Rubens owns anyway.

## Consequences

- A restricted number stops the assistant and the reminders for that organization
  until it is linked again. What came due meanwhile then goes out, less what is
  no longer true.
- Rubens offers software against WhatsApp's terms, which name third-party software
  that reproduces the service, so the risk is Rubens' as a vendor, not only the
  organization's. An organization is told so before it links its number.
- A WhatsApp change can stop every organization at once until an engine is fixed
  or switched. WAHA's releases are watched like a dependency's.
- WAHA holds each number's session keys, which are as sensitive as the phone
  itself: its storage is a secret, backed up and restored like the database.
- Patients' messages reach the model's provider, abroad. Health data is sensitive
  under Ley 25.326, so the model gets only what the conversation needs, providers
  are chosen for no-training and retention terms, and the transfer is for counsel
  to confirm before go-live.
