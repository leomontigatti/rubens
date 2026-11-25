# ADR-0015: Staff read and answer patients in the app only

Date: 2026-11-23. Decided by the business owner. Supersedes ADR-0007 (a handoff carries
the patient's own words to Telegram), none of which was built.

underthing does not use Telegram. Notifications, handoffs and the replies people write to
patients live in the app, whose inbox already holds every conversation
([ADR-0010](./0010-whatsapp-cloud-api-number-per-organization.md)); the assistant answers
patients on WhatsApp and nobody else. ADR-0007 chose Telegram to avoid building an inbox,
and the inbox was built anyway. A second channel would send patients' words to a third
party and add a bot, a link per member and a second place to answer from, for a first
version whose point is the WhatsApp assistant.

Governs: `src/organization/inbox.ts`, `src/organization/notifications.ts`
