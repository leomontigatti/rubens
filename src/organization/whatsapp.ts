import { maskPhone, parsePhone } from "#/lib/phones.ts";
import { templateSendSchema } from "#/lib/whatsapp.ts";
import type { TemplateSend } from "#/lib/whatsapp.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import type { Database } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";

// The WhatsApp settings: for now, one approved template sent by hand through
// the Worker's configured number (#153), until the organization connects its
// own (ADR-0010). Who may call each is the object's concern: an admin.

const invalidInput = { ok: false, reason: "invalidInput" } as const;

/** What the settings page shows: the setting that keeps a send from being made, if any. */
export function getWhatsappSettings(cloud: WhatsappCloud) {
  return { ok: true, missing: cloud.missingSetting() } as const;
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
