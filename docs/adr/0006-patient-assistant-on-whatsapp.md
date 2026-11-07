# ADR-0006: Patients talk to an assistant on the organization's WhatsApp number

**Status**: accepted; partly superseded by
[ADR-0010](./0010-whatsapp-cloud-api-number-per-organization.md)

Date: 2026-11-04. The rules it serves are in [assistant.md](../domain/assistant.md);
the research behind it, with sources, is in
[whatsapp-assistant.md](../research/whatsapp-assistant.md).

Amended 2026-11-06: the channel (the organization's own number through WAHA, and the
precautions against a ban) and the pg-boss worker are superseded by ADR-0010, which puts
each organization on a new number on Meta's Cloud API, run from the organization's
Durable Object ([the old text](./superseded/0006-whatsapp-through-waha.md)). The
sections below are live.

Patients write to the practice on WhatsApp, and a reception desk is what the
business wants to need less of. So each organization's number gets an assistant
that answers, books, cancels and reschedules, and hands off to a person when it
cannot.

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

## TanStack AI

TanStack AI keeps the stack in one ecosystem and is provider-neutral. It reached 1.0 in
October 2026, so the tools are plain functions with Zod schemas, and the library is a thin
layer over them that can be swapped for the AI SDK without touching them. The model,
open-weight ones included, is chosen by running a set of booking conversations against
the candidates, not by its price. That set is the saved scenarios of the WhatsApp
settings' sandbox ([assistant.md](../domain/assistant.md#trying-it)).

## Considered and rejected

- **A hosted unofficial API** (Whapi.Cloud, UltraMsg, Green API, Z-API). Unofficial,
  like WAHA, a fee per number, and patients' conversations on one more company's
  servers.
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

- Patients' messages reach the model's provider, abroad. Health data is sensitive
  under Ley 25.326, so the model gets only what the conversation needs, providers
  are chosen for no-training and retention terms, and the transfer is for counsel
  to confirm before go-live.
