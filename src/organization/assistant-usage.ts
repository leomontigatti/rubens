import type { modelRunPurposes } from "#/lib/assistant.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { today } from "#/lib/schedules.ts";

import type { ModelUsage } from "#/organization/assistant-model.ts";
import type { Database, Writer } from "#/organization/database.ts";
import { modelUsage, transcriptionUsage } from "#/organization/whatsapp-schema.ts";

// What the organization's assistant uses (docs/domain/assistant.md § Costs):
// every run of the model, a turn's, a clinical check's or a template review's
// (#345), records the tokens its calls used and the model, and every voice
// note transcribed the audio's length and the model, on the organization's day. Meta bills its messages
// to the practice itself, so they are not here.

/** A run of the model: what it was for, and whether the sandbox ran it. */
interface ModelRun extends ModelUsage {
  purpose: (typeof modelRunPurposes)[number];
  sandbox: boolean;
}

/**
 * Records what one run of the model used, now, in a transaction of its own:
 * it is reported while the model's call is awaited, outside any other.
 */
export function recordModelUsage(database: Database, run: ModelRun) {
  database.transaction((tx) =>
    tx
      .insert(modelUsage)
      .values({ ...run, day: today(defaultTimeZone) })
      .run(),
  );
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
