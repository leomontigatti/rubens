import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { modelRunPurposes } from "#/lib/assistant.ts";

import { flag, id, timestamps } from "#/organization/schema-columns.ts";

// What the assistant used, for the practice to pay for what it uses
// (docs/domain/assistant.md § Costs): the model's tokens and the voice notes
// transcribed, each on the organization's day. A schema file of its own beside
// `schema.ts` and `whatsapp-schema.ts` (`drizzle.organization.config.ts`).

/**
 * What one run of the assistant's model used (docs/domain/assistant.md §
 * Costs): a turn's, a clinical check's or a template review's, in the sandbox or not, on the
 * organization's day, for the practice to pay for what it uses.
 */
export const modelUsage = sqliteTable(
  "model_usage",
  {
    id: id(),
    /** The local date of the run, in the organization's zone. */
    day: text("day").notNull(),
    model: text("model").notNull(),
    purpose: text("purpose", { enum: modelRunPurposes }).notNull(),
    sandbox: flag("sandbox").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("model_usage_day_idx").on(table.day)],
);

/**
 * One voice note the assistant had transcribed (docs/domain/assistant.md §
 * Costs): the model and the audio's length, which Workers AI bills, on the
 * organization's day, beside the model's tokens (`model_usage`).
 */
export const transcriptionUsage = sqliteTable(
  "transcription_usage",
  {
    id: id(),
    /** The local date of the transcription, in the organization's zone. */
    day: text("day").notNull(),
    model: text("model").notNull(),
    sandbox: flag("sandbox").notNull(),
    /** The audio's length, in milliseconds. */
    audioMs: integer("audio_ms").notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("transcription_usage_day_idx").on(table.day)],
);
