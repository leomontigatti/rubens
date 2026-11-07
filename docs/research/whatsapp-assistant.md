# WhatsApp assistant: channel, model and handoff options

What exists for a patient assistant on WhatsApp, first gathered 2026-11-04; Meta's
Cloud API section checked again on primary sources on 2026-11-06. What Rubens
decided: [ADR-0010](../adr/0010-whatsapp-cloud-api-number-per-organization.md),
[ADR-0006](../adr/0006-patient-assistant-on-whatsapp.md) and
[ADR-0007](../adr/0007-patients-words-on-telegram.md). Prices change; check them
again before setting what an organization pays.

## WhatsApp on Meta's Cloud API

The route Rubens took on 2026-11-06.

- **Pricing**, per delivered message, by the recipient's market and the template's
  category. Meta's rate card effective 2026-10-01 (the spreadsheets linked from
  [Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing))
  gives Argentina:

  | Category       | USD    | ARS     |
  | -------------- | ------ | ------- |
  | Marketing      | 0.0618 | 89.562  |
  | Utility        | 0.026  | 37.6798 |
  | Authentication | 0.026  | 37.6798 |
  | Service        | 0.026  | 37.6798 |

  Utility and authentication get volume tiers only above 100,000 a month (−5%).

- **Service messages are charged since 2026-10-01**: free-form messages inside the
  window cost the utility rate after 1,000 free per business phone number a month,
  with no roll-over and no volume tiers. Utility templates inside the window are no
  longer free. A free entry point window (from an ad or a call-to-action) lasts up
  to 7 days ([pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing),
  [non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)).
- **Superseded**: the July 2025 rate card (US$0.0289 utility and authentication,
  service messages free, utility templates free inside the window) and the
  then-unverified claim of 1,000 free service messages, which Meta's pages now
  confirm.
- **The customer service window**: 24 hours after the user's last message, inside
  which free-form messages go; a template after that.
- **Messaging limits**: a new business portfolio can start conversations with 250
  unique recipients per rolling 24 hours outside a window, 2,000 after business
  verification, then scales automatically
  ([messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)).
- **Template categories**: utility must be non-promotional and specific to the
  user's transaction. Meta can recategorize a template after approval, at once for
  repeat offenders
  ([guidelines](https://developers.facebook.com/docs/whatsapp/updates-to-pricing/new-template-guidelines/)).
- **Tech Provider**: customers own their WhatsApp assets and add their own payment
  method, and Meta bills them. The steps: a Meta app with the WhatsApp use case,
  business verification, and App Review for advanced access to
  `whatsapp_business_messaging` and `whatsapp_business_management`, each with its own
  write-up and screen recording (a message sent from the app and received in
  WhatsApp; a template created in the app). App Review averages about 24 hours;
  business verification has no stated timeline. Until access verification, up to 10
  new customers per rolling 7 days, then 200. Onboarding is Embedded Signup, whose
  v2 and v3 were deprecated on 2026-10-15 for v4
  ([overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview),
  [get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers),
  [App Review](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review),
  [Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)).
  So a thin slice of the channel must work against a test number before applying.
- **Coexistence** (rejected): the WhatsApp Business app on a Cloud API number, for
  Solution Partners and Tech Providers only, app version 2.24.17 or later, 6 months
  of history synced, messages sent from the app echoed through `smb_message_echoes`,
  a fixed 20 messages per second, groups not synced, broadcast lists read-only
  ([onboarding Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)).
- **AI policy.** Meta restricted third-party general-purpose AI assistants from
  2026-01-15 and revised the policy in March 2026
  ([European Commission](https://europa.eu/newsroom/ecpc-failover/pdf/ip-26-805_en.pdf),
  [Meta business terms](https://www.whatsapp.com/legal/meta-terms-whatsapp-business)).
  A business's own booking or support assistant is reported to be allowed, by a
  secondary source only
  ([TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform));
  Meta's text does not name it as exempt.
- **Meta Business Agent** (rejected): Meta's own agent on a business's number, with
  knowledge sources, connectors to external APIs and thread control, at US$2.00 per
  million tokens, about US$0.04–0.05 per message, with no free tier
  ([get started](https://developers.facebook.com/documentation/meta-business-agent/get-started)).
- **Business-solution providers** ([Twilio](https://www.twilio.com/en-us/whatsapp/pricing),
  [360dialog](https://www.360dialog.com/pricing), [Gupshup](https://www.gupshup.io/pricing))
  add fees over Meta's in exchange for onboarding help.

### Cost example

1,000 reminders and 300 conversations of about six assistant messages each: 1,000
utility templates and 1,800 service messages, about 2,800 messages, about US$73 a
month (about ARS 105,000) at US$0.026, before the 1,000 free service messages.
Sending one message per reply instead of up to three brings it to about US$38.
Splitting replies multiplies the WhatsApp cost.

## Without Meta's API

The route ADR-0006 took, until ADR-0010 replaced it. Clients that link a number as a WhatsApp Web device, or
drive WhatsApp Web in a browser:

| Kind              | Options                                                                                                                                         | Notes                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Libraries         | [Baileys](https://github.com/WhiskeySockets/Baileys) (TypeScript, MIT), [whatsmeow](https://github.com/tulir/whatsmeow) (Go, MIT)               | Protocol sockets. Baileys' latest is `7.0.0-rc14`, a release candidate; v7 fixed a security advisory and a months-long parsing regression (May 2026).                                           |
| Browser libraries | [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js) (Apache-2.0), [WPPConnect](https://github.com/wppconnect-team/wppconnect)          | Drive Chromium: a browser per number.                                                                                                                                                           |
| Gateways          | [WAHA](https://waha.devlike.pro/), [Evolution API](https://github.com/EvolutionAPI/evolution-api), [WuzAPI](https://github.com/asternic/wuzapi) | HTTP and webhooks. WAHA's engines are Baileys, whatsmeow or a browser; since 2026.6.1 its free Core has unlimited sessions and media ([note](https://waha.devlike.pro/docs/how-to/waha-plus/)). |
| Hosted            | [Whapi.Cloud](https://whapi.cloud/price) US$29 per number a month, [UltraMsg](https://ultramsg.com/iw/) US$39, Green API, Z-API                 | The vendor holds the sessions and the conversations.                                                                                                                                            |

Bans, from GitHub issues, Reddit and WhatsApp's own pages (no X post was specific
enough to cite):

- WhatsApp's [terms](https://www.whatsapp.com/legal/terms-of-service?lang=en&x=0)
  forbid unofficial clients, and its [help centre](https://faq.whatsapp.com/1217634902127718/)
  says they can lead to temporary or permanent bans.
- Numbers have been disabled on first connecting, before sending anything, with a
  notice naming an unofficial client
  ([whatsapp-web.js #3594](https://github.com/wwebjs/whatsapp-web.js/issues/3594),
  [Evolution API #2659](https://github.com/evolution-foundation/evolution-api/issues/2659)).
- The reasons WhatsApp's servers give for a temporary ban, as whatsmeow decodes
  them: the same message to many people, messages to people who have not saved the
  number, and blocks ([events.go](https://github.com/tulir/whatsmeow/blob/main/types/events/events.go)).
- No evidence that delays, typing presence, warm-up, residential IPs or number age
  prevent bans, and no safe daily volume. One user was banned after 30 messages to
  non-contacts 30 seconds apart ([whatsmeow #199](https://github.com/tulir/whatsmeow/discussions/199));
  one operator claims 200–300 a day on six numbers for 14 months, unverified
  ([Reddit](https://www.reddit.com/r/n8n/comments/1we2e4x/waha_webjs_or_evolution_api_baileys_ban_rates/));
  10–12 a day to existing customers was banned
  ([Reddit](https://www.reddit.com/r/whatsapp/comments/1ghqwz3)).
- Clusters of warnings and bans in May and October 2025, with no confirmed cause
  ([whatsapp-web.js #3565](https://github.com/wwebjs/whatsapp-web.js/issues/3565),
  [Baileys #1869](https://github.com/WhiskeySockets/Baileys/issues/1869)).
- A restriction can reach the whole number, not only the linked device; an appeal
  sometimes works and can take weeks
  ([whatsmeow #567](https://github.com/tulir/whatsmeow/discussions/567)).
- No lawsuit was found against these projects or vendors.

## Libraries (npm, 2026-11-04)

| Package          | Version | Licence    | Notes                                                       |
| ---------------- | ------- | ---------- | ----------------------------------------------------------- |
| `@tanstack/ai`   | 1.0.1   | MIT        | Provider adapters, typed tools, agent loops; any framework. |
| `ai` (AI SDK)    | 7.0.162 | Apache-2.0 | Provider-neutral, runs on plain Node; no Vercel needed.     |
| `@mastra/core`   | 1.82.0  | Apache-2.0 | A full agent framework: memory, workflows, evals.           |
| `@openai/agents` | 0.21.0  | MIT        | OpenAI-centred agent loop and handoffs.                     |

([TanStack AI](https://tanstack.com/ai/latest/docs/getting-started/overview),
[AI SDK tools](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling))

## Models and transcription

- **Open-weight models** on US hosts (Together, Fireworks, DeepInfra, Groq) were
  listed by third-party trackers at about 0.04–0.15 input and 0.17–0.30 output
  (DeepSeek V4 Flash, gpt-oss-120b, Qwen Flash), unverified
  ([MorphLLM](https://www.morphllm.com/llm-api)). The makers' own APIs
  (DeepSeek, Moonshot, Z.ai) process in China. Tool-use rankings disagree
  ([BenchLM](https://benchlm.ai/best/tool-use)).
- **Models** (USD per million tokens, input/output): GPT-5.4 nano 0.20/1.25 and
  mini 0.75/4.50, text only
  ([OpenAI](https://openai.com/index/introducing-gpt-5-4-mini-and-nano/)); Gemini 3.1
  Flash-Lite 0.25/1.50, audio input 0.50 ([Google](https://ai.google.dev/gemini-api/docs/pricing)).
  Claude Haiku 5.5 was reported at 0.10/0.50, unverified. "Gemini 3.5 Flash-Lite" and
  "Gemini 3.8 Flash" do not exist.
- **Transcription** per minute: OpenAI `gpt-4o-mini-transcribe` US$0.003,
  `gpt-transcribe` US$0.0045 ([OpenAI](https://developers.openai.com/api/docs/pricing));
  Deepgram Nova-3 US$0.0043–0.0052 ([Deepgram](https://deepgram.com/pricing)); AssemblyAI
  from US$0.15 per hour ([AssemblyAI](https://www.assemblyai.com/products/speech-to-text/));
  self-hosted [faster-whisper](https://github.com/SYSTRAN/faster-whisper) costs only the
  server. Acceptance of WhatsApp's OGG/Opus voice notes is to be tested per provider.
- **Evaluation**: [promptfoo](https://www.promptfoo.dev/docs/) or
  [evalite](https://evalite.dev/) over a set of de-identified booking conversations.

## Health data

Ley 25.326 makes health data sensitive and restricts transfers abroad
([text](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/texto),
[AAIP](https://www.argentina.gob.ar/transferencias-internacionales)). No provider
found offers Argentine or Latin American residency. OpenAI and Google do not train
on paid API data by default; zero data retention is by eligibility or agreement
([OpenAI](https://openai.com/enterprise-privacy/), [Google](https://ai.google.dev/gemini-api/docs/zdr),
[Anthropic](https://privacy.anthropic.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to)).

## Inboxes and flow builders

- **Chatwoot** (MIT, active): WhatsApp Cloud and Telegram inboxes, agent bots with
  handoff and return; its AI, Captain, is paid-only; 4 cores and 8 GB suggested
  ([agent bots](https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots),
  [deploy](https://www.chatwoot.com/deploy)). Tiledesk (MIT) is the other candidate.
- **Flow builders**: n8n needs a commercial agreement for product use
  ([licence](https://docs.n8n.io/sustainable-use-license/)); Dify forbids multi-tenant
  use without permission ([licence](https://github.com/alibaba/dify/blob/main/LICENSE));
  Typebot is AGPL; Flowise ended on 2026-08-31 ([notice](https://flowiseai.com/sunset)).
- **Telegram Bot API**: replies thread through `reply_to_message`; about one message
  per second per chat; no charge for ordinary messages
  ([Bot API](https://core.telegram.org/bots/api), [FAQ](https://core.telegram.org/bots/faq)).
