import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { id, timestamps } from "#/organization/schema-columns.ts";

// What the object keeps of Meta's webhook calls beyond their events, in a
// schema file of its own beside `schema.ts` and `whatsapp-schema.ts`
// (`drizzle.organization.config.ts`).

/**
 * One element of a signed webhook call underthing could not read, a message
 * or a status, as Meta sent it (`src/organization/rejected-webhook-events.ts`):
 * sealed with the organization's key, for a later redrive, and deleted once
 * its retention ends. Meta does not send it again.
 */
export const rejectedWebhookEvent = sqliteTable(
  "rejected_webhook_event",
  {
    id: id(),
    /** The element's JSON, sealed. */
    element: text("element").notNull(),
    /** Where in the element the shape broke, as Zod's issue paths: keys and indexes, no values. */
    issues: text("issues", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("rejected_webhook_event_created_idx").on(table.createdAt)],
);
