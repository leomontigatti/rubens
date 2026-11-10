import { and, asc, gte, lte, sum } from "drizzle-orm";

import type { modelRunPurposes } from "#/lib/assistant.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { today } from "#/lib/schedules.ts";

import type { ModelUsage } from "#/organization/assistant-model.ts";
import type { Writer } from "#/organization/database.ts";
import { modelUsage, transcriptionUsage } from "#/organization/whatsapp-schema.ts";

// What the organization's assistant uses (docs/domain/assistant.md § Costs):
// every run of the model, a turn's or a clinical check's, records the tokens
// its calls used and the model, and every voice note transcribed the audio's
// length and the model, on the organization's day. Meta bills its messages
// to the practice itself, so they are not here.

/** A run of the model: what it was for, and whether the sandbox ran it. */
interface ModelRun extends ModelUsage {
  purpose: (typeof modelRunPurposes)[number];
  sandbox: boolean;
}

/** Records what one run of the model used, now. */
export function recordModelUsage(tx: Writer, run: ModelRun) {
  tx.insert(modelUsage)
    .values({ ...run, day: today(defaultTimeZone) })
    .run();
}

/** Records the transcription of a voice note `seconds` long, now. */
export function recordTranscription(
  tx: Writer,
  run: { model: string; seconds: number; sandbox: boolean },
) {
  tx.insert(transcriptionUsage)
    .values({
      day: today(defaultTimeZone),
      model: run.model,
      sandbox: run.sandbox,
      audioMs: Math.round(run.seconds * 1000),
    })
    .run();
}

/**
 * This month's usage in the organization's zone, as the WhatsApp settings
 * show it: the tokens of each model and the seconds of audio each
 * transcription model heard, the sandbox's apart.
 */
export function monthUsage(tx: Writer) {
  const month = today(defaultTimeZone).slice(0, "yyyy-MM".length);
  const [first, last] = [`${month}-01`, `${month}-31`];
  const models = tx
    .select({
      model: modelUsage.model,
      sandbox: modelUsage.sandbox,
      inputTokens: sum(modelUsage.inputTokens).mapWith(Number),
      outputTokens: sum(modelUsage.outputTokens).mapWith(Number),
    })
    .from(modelUsage)
    .where(and(gte(modelUsage.day, first), lte(modelUsage.day, last)))
    .groupBy(modelUsage.model, modelUsage.sandbox)
    .orderBy(asc(modelUsage.model), asc(modelUsage.sandbox))
    .all();
  const transcriptions = tx
    .select({
      model: transcriptionUsage.model,
      sandbox: transcriptionUsage.sandbox,
      audioMs: sum(transcriptionUsage.audioMs).mapWith(Number),
    })
    .from(transcriptionUsage)
    .where(and(gte(transcriptionUsage.day, first), lte(transcriptionUsage.day, last)))
    .groupBy(transcriptionUsage.model, transcriptionUsage.sandbox)
    .orderBy(asc(transcriptionUsage.model), asc(transcriptionUsage.sandbox))
    .all()
    .map(({ audioMs, ...used }) => ({ ...used, seconds: audioMs / 1000 }));
  return { month, models, transcriptions };
}
