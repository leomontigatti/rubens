# ADR-0007: A handoff carries the patient's own words to Telegram

**Status**: accepted; amended by
[ADR-0010](./0010-whatsapp-cloud-api-number-per-organization.md) and
[ADR-0013](./0013-reception-reads-every-conversation.md)

Date: 2026-11-04. Narrows the minimum-data rule for Telegram in
[messages.md](../domain/messages.md#to-staff), which sent only a patient's name and
times.

Amended 2026-11-06 (ADR-0010): with no phone on the organization's number, the app's
view is a full inbox, not a fallback: every conversation, readable by role, and any
allowed member can take one over at any time. Handoffs still carry the patient's words
to Telegram, and practitioners still reply from there. The fallback view this ADR
decided on 2026-11-04 is [kept apart](./superseded/0007-fallback-view.md).

Amended 2026-11-11 (ADR-0013): reception reads every conversation, and a handoff that
needs no practitioner goes to reception, so a handoff's recipient on Telegram may be
reception, not only the practitioner or a handoff contact.

When the assistant hands a conversation off, the practitioner or handoff contact
answers from Telegram, and Rubens relays the reply to the patient's WhatsApp. For
that, the handoff shows the patient's own words on Telegram, which can be health
data on a third party's servers.

The alternative was an inbox in Rubens: a conversation list, a thread, a reply box
and push notifications, built and kept for people who already read Telegram all
day. Telegram is less friction for them and less to build. Rubens stores the
conversation either way, so the record of every message stays in the app.

The exposure is kept to the handoff: only conversations handed off, only to the
person they are handed to. Cancellation and reschedule copies, and requests to
approve, keep the minimum. Rubens says nothing clinical on Telegram of its own; what
reaches it is what the patient wrote. Telegram's place in the privacy notice is
for counsel to confirm before go-live.
