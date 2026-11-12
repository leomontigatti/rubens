import { changedFields } from "#/lib/audit-fields.ts";
import { parseCommunicationRules } from "#/lib/communication-rules.ts";
import type { CommunicationRulesInput, FormOfAddress } from "#/lib/communication-rules.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { rewordDefaultDrafts } from "#/organization/templates.ts";
import { communicationRules } from "#/organization/whatsapp-schema.ts";

// The organization's communication rules for the assistant (`src/lib/communication-rules.ts`):
// read by the WhatsApp settings and by the assistant, which records the
// version each reply was written under, and saved by an admin. Who may call
// each is the object's concern.

export interface CommunicationRules {
  formOfAddress: FormOfAddress;
  tone: string;
  /** E.164, which the emergency reply gives; empty for none. */
  phone: string;
  /** 0 until an admin first saves them. */
  version: number;
}

/** What the assistant writes under before any admin saved the rules. */
const startingRules: CommunicationRules = {
  formOfAddress: "vos",
  tone: "",
  phone: "",
  version: 0,
};

/** The rules in force, and their version. */
export function currentCommunicationRules(database: Writer): CommunicationRules {
  const row = database
    .select({
      formOfAddress: communicationRules.formOfAddress,
      tone: communicationRules.tone,
      phone: communicationRules.phone,
      version: communicationRules.version,
    })
    .from(communicationRules)
    .get();
  return row ?? startingRules;
}

/**
 * Saves `input` as the rules, as `acting`, under the next version, and audits
 * what changed with the version it made. Every save makes a version, one that
 * changes nothing included. The default drafts never sent follow its `Trato`.
 */
export function saveCommunicationRules(
  database: Database,
  acting: Acting,
  input: CommunicationRulesInput,
) {
  const parsed = parseCommunicationRules(input);
  if (!parsed.ok) {
    return parsed;
  }
  return database.transaction((tx) => {
    const { version, ...before } = currentCommunicationRules(tx);
    const after = { ...parsed.rules, version: version + 1 };
    const changed = changedFields(before, parsed.rules);
    tx.insert(communicationRules)
      .values({ id: 1, ...after })
      .onConflictDoUpdate({ target: communicationRules.id, set: after })
      .run();
    recordAudit(tx, acting.userId, {
      action: "update",
      entityType: "communicationRules",
      entityId: "communicationRules",
      patientId: null,
      before: { ...changed?.before, version },
      after: { ...changed?.after, version: after.version },
    });
    rewordDefaultDrafts(tx, acting, after.formOfAddress);
    return { ok: true, version: after.version } as const;
  });
}
