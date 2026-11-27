import { lte, min } from "drizzle-orm";

import { log } from "#/lib/log.ts";
import type { RejectedWebhookElement } from "#/lib/whatsapp-messages.ts";

import type { Database } from "#/organization/database.ts";
import type { OrganizationCipher } from "#/organization/encryption.ts";
import type { Job } from "#/organization/jobs.ts";
import { organizationIdIn } from "#/organization/whatsapp-connection.ts";
import { rejectedWebhookEvent } from "#/organization/webhook-schema.ts";

// The elements of Meta's webhook calls underthing could not read
// (`src/server/whatsapp-webhook.ts`): Meta does not send a call again once it
// was answered, so each is kept as Meta sent it, sealed with the
// organization's key because a message holds a patient's words, for a person
// to redrive once the reading is fixed. Each is deleted once its retention
// ends. Nothing here logs an element.

const dayMs = 24 * 60 * 60_000;

/** How long a rejected element is kept. */
const retentionMs = 30 * dayMs;

/**
 * Keeps `rejected` sealed, a row per statement in one transaction. Refused by
 * an object no organization was set up in, and, logged, while the Worker's
 * key is missing or not a key: an element is never stored in clear, and the
 * refusal has Meta send the call again once the key is set.
 */
export async function keepRejectedWebhookEvents(
  database: Database,
  cipherOf: (organizationId: string) => Promise<OrganizationCipher | null>,
  rejected: RejectedWebhookElement[],
) {
  const organizationId = organizationIdIn(database);
  if (!organizationId) {
    return { ok: false, reason: "notSetUp" } as const;
  }
  const cipher = await cipherOf(organizationId).catch(() => null);
  if (!cipher) {
    log.error("rejected-webhook-events", "kept no rejected element: no usable encryption key", {
      elements: rejected.length,
    });
    return { ok: false, reason: "noEncryptionKey" } as const;
  }
  const sealed = await Promise.all(
    rejected.map(async ({ element, issues }) => ({
      element: await cipher.seal(element, "rejectedWebhookEvent"),
      issues,
    })),
  );
  database.transaction((tx) => {
    for (const row of sealed) {
      tx.insert(rejectedWebhookEvent).values(row).run();
    }
  });
  return { ok: true, stored: sealed.length } as const;
}

export const rejectedWebhookEventsJob: Job = {
  name: "rejected webhook events",
  nextDue(database) {
    const oldest = database
      .select({ at: min(rejectedWebhookEvent.createdAt) })
      .from(rejectedWebhookEvent)
      .get();
    const at = oldest?.at ?? null;
    return at === null ? null : at + retentionMs;
  },
  run(database) {
    database.transaction((tx) =>
      tx
        .delete(rejectedWebhookEvent)
        .where(lte(rejectedWebhookEvent.createdAt, Date.now() - retentionMs))
        .run(),
    );
  },
};
