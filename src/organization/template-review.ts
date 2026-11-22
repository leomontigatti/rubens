import { templateReviewRequestSchema } from "#/lib/whatsapp-templates.ts";
import type { TemplateReviewRequest } from "#/lib/whatsapp-templates.ts";
import { errorClass, log } from "#/lib/log.ts";

import type { AssistantModel, ModelUsage } from "#/organization/assistant-model.ts";
import { recordModelUsage } from "#/organization/assistant-usage.ts";
import { currentCommunicationRules } from "#/organization/communication-rules.ts";
import type { Database } from "#/organization/database.ts";

// The assistant's review of a template's text (#345): the text an admin is
// writing, saved or not, read by the assistant's model under the
// organization's Trato and Tono. It stores nothing but the model's usage, and
// refuses nothing it reads: a note only advises.

/** The model's notes on `input`'s text, or why there are none. */
export async function reviewTemplate(
  database: Database,
  model: AssistantModel,
  input: TemplateReviewRequest,
) {
  const parsed = templateReviewRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" } as const;
  }
  if (model.missingSetting()) {
    return { ok: false, reason: "missingApiKey" } as const;
  }
  const { formOfAddress, tone } = currentCommunicationRules(database);
  const recordUsage = (used: ModelUsage) =>
    recordModelUsage(database, { ...used, purpose: "templateReview", sandbox: false });
  try {
    const { notes } = await model.reviewTemplate({
      body: parsed.data.body,
      formOfAddress,
      tone,
      recordUsage,
    });
    return { ok: true, notes } as const;
  } catch (error) {
    log.error("template-review", "review failed", { error: errorClass(error) });
    return { ok: false, reason: "reviewFailed" } as const;
  }
}
