# ADR-0007, last section: a minimal view in Rubens as the fallback

**Status**: superseded by [ADR-0010](../0010-whatsapp-cloud-api-number-per-organization.md)
on 2026-11-06, which makes the view a full inbox. The rest of
[ADR-0007](../0007-patients-words-on-telegram.md) is live. Kept for its rationale.

Rubens keeps a minimal view of its own as the fallback: the open handoffs and
requests, the conversation and a reply box, for a member without Telegram, a
Telegram outage, and checking what was said. It is not the full inbox ADR-0007
weighed: no assigning, no labels, no push notifications beyond the existing ones.

If the exposure proves unacceptable, the reversal is that view as the only place
to answer, with Telegram back to a notification and a link.
