import { and, asc, gte, lte, sum } from "drizzle-orm";

import type { modelRunPurposes } from "#/lib/assistant.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { today } from "#/lib/schedules.ts";

import type { ModelUsage } from "#/organization/assistant-model.ts";
import type { Writer } from "#/organization/database.ts";
import { modelUsage } from "#/organization/whatsapp-schema.ts";

// What the organization's assistant uses (docs/domain/assistant.md § Costs):
// every run of the model, a turn's or a clinical check's, records the tokens
// its calls used and the model, on the organization's day. Meta bills its
// messages to the practice itself, so they are not here.

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

/**
 * This month's usage in the organization's zone, as the WhatsApp settings
 * show it: the tokens of each model, the sandbox's apart.
 */
export function monthUsage(tx: Writer) {
  const month = today(defaultTimeZone).slice(0, "yyyy-MM".length);
  const models = tx
    .select({
      model: modelUsage.model,
      sandbox: modelUsage.sandbox,
      inputTokens: sum(modelUsage.inputTokens).mapWith(Number),
      outputTokens: sum(modelUsage.outputTokens).mapWith(Number),
    })
    .from(modelUsage)
    .where(and(gte(modelUsage.day, `${month}-01`), lte(modelUsage.day, `${month}-31`)))
    .groupBy(modelUsage.model, modelUsage.sandbox)
    .orderBy(asc(modelUsage.model), asc(modelUsage.sandbox))
    .all();
  return { month, models };
}
