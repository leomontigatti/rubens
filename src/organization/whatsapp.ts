import { maskPhone, parsePhone } from "#/lib/phones.ts";
import { templateSendSchema } from "#/lib/whatsapp.ts";
import type { TemplateSend } from "#/lib/whatsapp.ts";

import { currentCommunicationRules } from "#/organization/communication-rules.ts";
import { returnAfterHours } from "#/organization/conversation-holds.ts";
import { handoffReminders } from "#/organization/handoff-countdown.ts";
import { recordAudit } from "#/organization/audit.ts";
import { listHandoffContacts } from "#/organization/handoff-contacts.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import type { Database } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import type { WhatsappNumber } from "#/organization/whatsapp-connection.ts";
import { activeHold } from "#/organization/whatsapp-limits.ts";
import { listWhatsappTemplates } from "#/organization/whatsapp-templates.ts";

// The WhatsApp settings: the organization's number
// (`src/organization/whatsapp-connection.ts`), its templates
// (`src/organization/whatsapp-templates.ts`) and one approved template sent by
// hand (#153). Who may call each is the object's concern: an admin.

const invalidInput = { ok: false, reason: "invalidInput" } as const;

/**
 * What the settings page shows: the organization's number, the hold Meta put
 * on it if any, and what Embedded Signup launches with (`null` while the Worker misses a setting), the setting
 * that keeps a send from being made, if any, and the templates with the
 * setting that keeps them from being submitted, the assistant's
 * communication rules, the members who may be handoff contacts, the return
 * time and the handoff reminders.
 */
export function getWhatsappSettings(
  database: Database,
  cloud: WhatsappCloud,
  number: WhatsappNumber,
) {
  const { missing: templateMissing, templates } = listWhatsappTemplates(database, cloud);
  return {
    ok: true,
    connection: number.read(),
    hold: activeHold(database, Date.now()),
    signup: number.launch(),
    missing: cloud.missingSetting(),
    templateMissing,
    templates,
    communicationRules: currentCommunicationRules(database),
    handoffContacts: listHandoffContacts(database).members,
    returnAfterHours: returnAfterHours(database),
    handoffReminders: handoffReminders(database),
  } as const;
}

/**
 * Sends `input`'s template to its recipient, as `acting`, and answers with
 * Meta's verdict. Every send Meta answers is audited, accepted or refused.
 */
export async function sendTemplate(
  database: Database,
  cloud: WhatsappCloud,
  acting: Acting,
  input: TemplateSend,
) {
  const parsed = templateSendSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const phone = parsePhone(parsed.data.to);
  if (!phone.ok) {
    return phone;
  }
  const missing = cloud.missingSetting();
  if (missing) {
    return { ok: false, reason: missing } as const;
  }
  const { templateName, languageCode } = parsed.data;
  const sent = await cloud.sendTemplate({ to: phone.phone, templateName, languageCode });
  database.transaction((tx) =>
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "whatsappMessage",
      // A refused send has no message id of Meta's, so each send gets its own.
      entityId: crypto.randomUUID(),
      patientId: null,
      before: null,
      after: {
        to: maskPhone(phone.phone),
        templateName,
        languageCode,
        messageId: sent.ok ? sent.messageId : null,
        metaErrorCode: sent.ok ? null : sent.metaError.code,
      },
    }),
  );
  return sent;
}
