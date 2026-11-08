# The assistant's evaluation

The set of booking conversations that picks the patient assistant's model and its
transcription option (#157, ADR-0006 § TanStack AI). Each case is one assistant turn
after a conversation so far, run through the drafted prompt and tool schemas with
TanStack AI, against a fake organization object that answers from made-up data. It
calls the providers' real APIs, so it costs money and runs on demand, never in CI.

## Running

Put the keys in `.env.local` (ignored by git; both scripts load it) or in the
environment. Each provider needs only its own:

| Provider   | Variables                                       |
| ---------- | ----------------------------------------------- |
| OpenAI     | `OPENAI_API_KEY`                                |
| Gemini     | `GOOGLE_API_KEY` or `GEMINI_API_KEY`            |
| Anthropic  | `ANTHROPIC_API_KEY`                             |
| Workers AI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` |

One candidate, each case three times:

```sh
pnpm eval:assistant gpt-5.4-nano --repeat 3
pnpm eval:assistant gpt-5.4-mini --repeat 3
pnpm eval:assistant gemini-3.1-flash-lite --repeat 3
pnpm eval:assistant claude-haiku-5-5 --repeat 3
pnpm eval:assistant gpt-oss-120b --repeat 3
```

With no label it runs every candidate in `candidates.ts`. `--case <id>` runs one case,
and `--concurrency 2` suits an account with a tight rate limit; a rate limit or an
overload is retried, any other error counts against the candidate. The summary table
is printed and saved in `results/` (ignored by git) with the full results;
`pnpm eval:report tests/evals/assistant/results/assistant-*.json` folds several saved
runs into one table, and `pnpm exec promptfoo view` browses every turn's reply, tool
calls and checks.

The voice notes, through every transcription option, with the chosen assistant model:

```sh
pnpm eval:voice --assistant claude-haiku-5-5 --repeat 2
pnpm eval:voice gpt-4o-mini-transcribe --assistant claude-haiku-5-5
```

## What a turn is scored on

In the order #157 ranks the criteria (`score.ts`):

1. **Tool choice** (`1a`): every call the case requires, with its arguments, none it
   forbids, and `judge_messages` at least once (the last judgement counts). **No invented availability** (`1b`):
   every clock time in the reply was returned by a tool or said earlier in the
   conversation.
2. **Handoff when due**: `hand_off` exactly when the case says, with the right
   clinical flag and a reason the case accepts; the judgement (clinical, emergency)
   as the case expects.
3. **Voice notes** (`eval:voice`): the word error rate against the words spoken, at
   most 0.2, and the turn on the transcript passing 1a, 1b and 2 like the written case.

The `reply content` check holds what only the words show: a proposal stated in full,
yes when asked whether it is a bot, no advice on symptoms. Latency (p50, p95) and cost
per turn come with each run; the providers' terms are in the report on #151.

The availability check reads clock times only: an invented office, floor or price is
caught only where a case's `replyAvoids` names it.

## The set

`cases.ts` holds the written conversations, `world.ts` the organization they run
against. Nothing in either is a real patient, number, practitioner or address. To add a
case, give it a conversation so far, the patient's new messages and what the turn must
and must not do; `fake-object.ts` answers its tools from `world.ts`.

`prompt.ts` and `tools.ts` are drafts of #169's prompt and tool schemas. When #169
lands, point `turn.ts` at the real ones and drop the drafts.

### Voice notes

`voice/*.ogg` are synthesized, not recorded: Microsoft Edge's neural voices
`es-AR-ElenaNeural` and `es-AR-TomasNeural` (the `edge-tts` Python package), then
ffmpeg with a 200–3,800 Hz band-pass and, for the notes marked noisy, brown noise mixed
in, encoded as WhatsApp does: `-ac 1 -ar 16000 -c:a libopus -b:a 16k -application voip`.
Synthetic speech is cleaner than a patient's voice note in the street, so a pass here
is necessary, not sufficient: real notes, recorded with consent and de-identified, go
in `voice/` with their words in `notes.ts` before voice notes go live (#184).
