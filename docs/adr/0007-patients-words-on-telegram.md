# ADR-0007: A handoff carries the patient's own words to Telegram

**Status**: accepted

Date: 2026-11-04. Narrows the minimum-data rule for Telegram in
[messages.md](../domain/messages.md#to-staff), which sent only a patient's name and
times.

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

Rubens keeps a minimal view of its own as the fallback: the open handoffs and
requests, the conversation and a reply box, for a member without Telegram, a
Telegram outage, and checking what was said. It is not the full inbox weighed
above: no assigning, no labels, no push notifications beyond the existing ones.

If the exposure proves unacceptable, the reversal is that view as the only place
to answer, with Telegram back to a notification and a link.
