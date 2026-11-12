import { currentCommunicationRules } from "#/organization/communication-rules.ts";
import { returnAfterHours } from "#/organization/personal-replies.ts";
import { handoffReminders } from "#/organization/handoff-countdown.ts";
import { listHandoffContacts } from "#/organization/handoff-contacts.ts";
import type {
  MissingSetting,
  MissingTemplateSetting,
  WhatsappCloud,
} from "#/organization/graph-api.ts";
import type { Database } from "#/organization/database.ts";
import type { WhatsappNumber } from "#/organization/whatsapp-connection.ts";
import { activeHold } from "#/organization/whatsapp-limits.ts";
import { monthMessages } from "#/organization/month-messages.ts";
import { organizationName } from "#/organization/members.ts";
import { listTemplates } from "#/organization/templates.ts";

// The WhatsApp settings: the organization's number
// (`src/organization/whatsapp-connection.ts`) and its templates
// (`src/organization/whatsapp-templates.ts`), with the rest of what the
// assistant runs on. Who may read them is the object's concern: an admin.

// What the Worker misses, for whoever runs it: the admin is only told to connect the number.
const missingSettingLogs: Record<
  Exclude<MissingSetting | MissingTemplateSetting, "connectionFailed">,
  string
> = {
  missingAccessToken: "no number is connected and WHATSAPP_ACCESS_TOKEN is not set",
  missingPhoneNumberId: "WHATSAPP_PHONE_NUMBER_ID is not set",
  missingBusinessAccountId: "WHATSAPP_BUSINESS_ACCOUNT_ID is not set",
};

function logMissingSettings(...settings: (MissingSetting | MissingTemplateSetting | null)[]) {
  for (const setting of new Set(settings)) {
    if (setting && setting !== "connectionFailed") {
      console.warn(`[whatsapp-settings] ${setting}: ${missingSettingLogs[setting]}`);
    }
  }
}

/**
 * What the settings pages show: the organization's number, the hold Meta put
 * on it if any, and what Embedded Signup launches with (`null` while the Worker misses a setting),
 * the templates with the setting that keeps them from being submitted, the assistant's
 * communication rules, the members who may be handoff contacts, the return
 * time, the handoff reminders and the month's WhatsApp messages.
 */
export function getWhatsappSettings(
  database: Database,
  cloud: WhatsappCloud,
  number: WhatsappNumber,
) {
  const { missing: templateMissing, templates } = listTemplates(database, cloud);
  logMissingSettings(cloud.missingSetting(), templateMissing);
  const signupMissing = number.missingSignupSetting();
  if (signupMissing) {
    console.warn(`[whatsapp-settings] signupNotConfigured: ${signupMissing} is not set`);
  }
  return {
    ok: true,
    connection: number.read(),
    hold: activeHold(database, Date.now()),
    signup: number.launch(),
    templateMissing,
    templates,
    organizationName: organizationName(database),
    communicationRules: currentCommunicationRules(database),
    handoffContacts: listHandoffContacts(database).members,
    returnAfterHours: returnAfterHours(database),
    handoffReminders: handoffReminders(database),
    messages: monthMessages(database),
    businessAccountId: cloud.businessAccountId(),
  } as const;
}
