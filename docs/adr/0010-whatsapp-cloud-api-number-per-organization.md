# ADR-0010: Each organization gets a new number on Meta's WhatsApp Cloud API

**Status**: accepted; not built yet. Supersedes the channel decision of
[ADR-0006](./0006-patient-assistant-on-whatsapp.md) (WAHA on the organization's own
number) and its pg-boss worker. ADR-0006's sections on the model interpreting and
Rubens deciding, proposals and TanStack AI stay in force. Amends
[ADR-0007](./0007-patients-words-on-telegram.md): the app's view becomes a full inbox.

Date: 2026-11-06. Decided with the business owner. The rules it serves are in
[assistant.md](../domain/assistant.md) and [messages.md](../domain/messages.md); the
facts behind it, with sources, are in
[whatsapp-assistant.md](../research/whatsapp-assistant.md).

After the port to Workers ([ADR-0008](./0008-cloudflare-workers-one-object-per-organization.md))
there is no always-on host for WAHA, and the point of the port is to run no servers. So
patients reach the assistant through Meta's official WhatsApp Cloud API, on a new number
per organization, and Rubens pays the price of the official channel: a template approved
for every message it starts, a fee per delivered message, and the 24-hour window.

## A new number, owned by the practice

Each organization gets a new number used only through the Cloud API: no phone, no
WhatsApp Business app, no coexistence. Every reply a person writes goes through Rubens,
from the app's inbox or from Telegram.

The practice owns its WhatsApp Business account and the number, in its own Meta business
portfolio, adds its own payment method, and Meta bills it directly, in pesos if it
chooses. Rubens is a Meta Tech Provider and onboards a practice through Embedded Signup
v4 (v2 and v3 were deprecated on 2026-10-15). No practice hands Rubens a token by any
other route.

## Templates and the window

Every message Rubens starts is a template the practice has approved in its own account,
in the utility category, written in its voice (`vos` or `usted`, its sign-off). A
template may have several approved versions. None has buttons: the business does not
want the first message to read like a system notice.

The patient's reply opens the customer service window, and each later message from the
patient restarts it; a template does not open it. Inside the window the assistant
chats freely. Outside it, Rubens can send only a template.

## The webhook stores, the object's alarm acts

Meta's webhook reaches the Worker, which verifies the signature, stores each message once
(by its WhatsApp id) in the organization's Durable Object, and answers Meta at once. The
object's one alarm, set to the earliest due item, runs everything: reminders, the wait
until the patient stops writing, the model call and the reply, and the warnings before a
window closes. A turn that needs step-wise retries runs as a Cloudflare Workflow, on the
free plan. This replaces the pg-boss worker of ADR-0006.

## A full inbox in the app

With no phone, the app is where people read and answer patients. Every conversation is
readable by reception and admins, with the messages judged clinical, and those not
judged yet, hidden from anyone who is not a practitioner who keeps clinical records; a
practitioner sees the conversations about their own appointments and those handed to
them. The assistant judges every patient message, also while a person holds the
conversation. Anyone allowed can take a conversation over
at any time, not only on a handoff. Practitioners keep replying from Telegram
(ADR-0007); the inbox is no longer only its fallback.

## Considered options

- **WAHA on a small host.** An always-on server again, against ADR-0008's goal; a
  breach of WhatsApp's terms with a ban risk no one can measure; and its main advantage,
  keeping the phone's WhatsApp app, is what coexistence offers on the official API.
- **Coexistence** (the WhatsApp Business app on a Cloud API number). Not needed with no
  phone, and it limits the number: groups are not synced, broadcast lists become
  read-only, disappearing messages are off, and throughput is fixed at 20 messages a
  second.
- **A hosted unofficial API**, rejected as in ADR-0006.
- **Meta Business Agent**, Meta's own agent on the number: US$2 per million tokens,
  about US$0.04–0.05 per message, no free tier. Its replies go straight from Meta's
  model to the patient, so Rubens' check before sending (nothing clinical, the facts as
  given, only the latest proposal accepted) and the record of the rules version each
  reply was written under cannot sit in between. Rubens could not evaluate the model
  itself, practitioners on Telegram would need a second assistant, and the business would
  be locked in. Its one real advantage: no extra processor of patients' messages.
- **Quick-reply buttons** in templates: exact answers, but the first message would read
  like a system notice.
- **The reschedule link**, a signed page to move or cancel one appointment: dropped.
  Rescheduling happens in the conversation, under the same rules, so there is one way
  to do it and no public page or token to secure.

## Consequences

- **A slice of the channel must exist before Rubens applies as a Tech Provider.** App
  Review asks, for each of `whatsapp_business_messaging` and
  `whatsapp_business_management`, a write-up and a screen recording made with the app
  against a test number: a message sent from the app and received in WhatsApp, a
  template created from the app. Review takes about a day on average; business
  verification has no stated timeline. Until access verification, Rubens can onboard
  10 new practices per rolling 7 days, then 200.
- **Each message costs money, and the practice pays it.** In Argentina, US$0.026 per
  utility template or service message (from 2026-10-01, service messages are free only
  for the first 1,000 a month per number). Splitting a reply into several messages
  multiplies the cost. Meta can recategorize a template as marketing (US$0.0618) after
  approval.
- **A new number starts limited**: 250 unique recipients per rolling 24 hours outside
  a window, 2,000 after business verification, then scaling on its own.
- **A person's late reply needs the patient to answer first.** After the window closes,
  Rubens sends a template inviting a reply and delivers the person's reply when the
  patient answers. The reply itself never goes into a template variable.
- **An incoming message the model cannot read yet waits** and is retried while the
  window is open, then handed to a person well before it closes. There is no parsing
  in code as a second interpreter.
- **The ban risk, the session keys and the phone that reads everything are gone.**
  Every conversation is in Rubens, so the rule that hides clinical messages from
  reception holds everywhere.
- **Meta's AI-provider restriction** (from 2026-01-15) bars general-purpose assistants
  as the product. A business's own booking assistant is reported to be allowed, by a
  secondary source only; Meta's text is to be read again before go-live.
- Patients' messages still reach the model's provider abroad, as ADR-0006 says, and now
  Meta as the channel.
