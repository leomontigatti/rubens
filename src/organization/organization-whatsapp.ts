import type { CommunicationRulesInput } from "#/lib/communication-rules.ts";
import type { PersonalReply, ReturnTimeInput } from "#/lib/conversation-holds.ts";
import type { HandoffContactsInput } from "#/lib/handoff-contacts.ts";
import type { HandoffReference, OpenHandoffListOptions } from "#/lib/handoffs.ts";
import type { SignupCompletion, TemplateSend } from "#/lib/whatsapp.ts";
import type { ConversationReference, WhatsappEvents } from "#/lib/whatsapp-messages.ts";
import type { TemplateSubmission } from "#/lib/whatsapp-templates.ts";

import { saveCommunicationRules } from "#/organization/communication-rules.ts";
import {
  replyToConversation,
  returnConversation,
  saveReturnTime,
  takeOverConversation,
} from "#/organization/conversation-holds.ts";
import { listHandoffContacts, replaceHandoffContacts } from "#/organization/handoff-contacts.ts";
import { closeHandoffWithoutReply, listOpenHandoffs } from "#/organization/handoff-inbox.ts";
import { patientEditors } from "#/organization/members.ts";
import type { Caller } from "#/organization/members.ts";
import { OrganizationRuntime } from "#/organization/organization-runtime.ts";
import { organizationIdIn } from "#/organization/whatsapp-connection.ts";
import { storeWhatsappEvents } from "#/organization/whatsapp-messages.ts";
import { getWhatsappSettings, sendTemplate } from "#/organization/whatsapp.ts";
import {
  refreshWhatsappTemplates,
  submitWhatsappTemplate,
} from "#/organization/whatsapp-templates.ts";

/**
 * The organization object's WhatsApp methods (`Organization` extends this):
 * Meta's webhook events, the inbox's handoffs and takeovers, and the WhatsApp settings,
 * which only admins use.
 * Each method is one line into its area module, as in `organization.ts`.
 */
export abstract class OrganizationWhatsapp extends OrganizationRuntime {
  /**
   * Meta's webhook, after the Worker checked its signature and found the
   * organization (`src/server/whatsapp-webhook.ts`). Refused by an object no
   * organization was set up in, so a stale mapping fails loudly.
   */
  storeWhatsappEvents(events: WhatsappEvents) {
    if (!organizationIdIn(this.database)) {
      return { ok: false, reason: "notSetUp" } as const;
    }
    // A template's approval lets the messages waiting on it go.
    return this.thenArm(() => storeWhatsappEvents(this.database, events));
  }

  /** The open handoffs the member sees in the inbox (`src/organization/handoff-inbox.ts`). */
  listOpenHandoffs(caller: Caller, input: OpenHandoffListOptions) {
    return this.as(caller, patientEditors, (acting) =>
      listOpenHandoffs(this.database, acting, input),
    );
  }

  closeHandoff(caller: Caller, input: HandoffReference) {
    return this.as(caller, patientEditors, (acting) =>
      closeHandoffWithoutReply(this.database, acting, input),
    );
  }

  /** Takes a conversation the member reads over from the assistant (`src/organization/conversation-holds.ts`). */
  takeOverConversation(caller: Caller, input: ConversationReference) {
    // Its hold ends by the alarm.
    return this.asThenArm(caller, patientEditors, (acting) =>
      takeOverConversation(this.database, acting, input),
    );
  }

  async replyToConversation(caller: Caller, input: PersonalReply) {
    return this.asThenArm(caller, patientEditors, (acting) =>
      replyToConversation(this.database, this.whatsapp, acting, input),
    );
  }

  async returnConversation(caller: Caller, input: ConversationReference) {
    return this.asThenArm(caller, patientEditors, (acting) =>
      returnConversation(this.database, this.whatsapp, acting, input),
    );
  }

  /** How long a member holds a conversation before it goes back to the assistant. */
  saveReturnTime(caller: Caller, input: ReturnTimeInput) {
    return this.as(caller, ["admin"], (acting) => saveReturnTime(this.database, acting, input));
  }

  whatsappSettings(caller: Caller) {
    return this.as(caller, ["admin"], () =>
      getWhatsappSettings(this.database, this.whatsapp, this.number),
    );
  }

  /** Completes Embedded Signup with what its popup returned. */
  async connectWhatsapp(caller: Caller, input: SignupCompletion) {
    // A number connected lets the messages waiting on one go.
    return this.asThenArm(caller, ["admin"], (acting) => this.number.connect(acting, input));
  }

  async disconnectWhatsapp(caller: Caller) {
    return this.as(caller, ["admin"], (acting) => this.number.disconnect(acting));
  }

  async sendWhatsappTemplate(caller: Caller, input: TemplateSend) {
    return this.as(caller, ["admin"], (acting) =>
      sendTemplate(this.database, this.whatsapp, acting, input),
    );
  }

  async submitWhatsappTemplate(caller: Caller, input: TemplateSubmission) {
    return this.asThenArm(caller, ["admin"], (acting) =>
      submitWhatsappTemplate(this.database, this.whatsapp, acting, input),
    );
  }

  /** The assistant's `vos` or `usted`, sign-off and tone (#185), which the settings read back. */
  async saveCommunicationRules(caller: Caller, input: CommunicationRulesInput) {
    return this.as(caller, ["admin"], (acting) =>
      saveCommunicationRules(this.database, acting, input),
    );
  }

  /** The members an admin picks the handoff contacts from (#170), with who is one now. */
  handoffContacts(caller: Caller) {
    return this.as(caller, ["admin"], () => listHandoffContacts(this.database));
  }

  saveHandoffContacts(caller: Caller, input: HandoffContactsInput) {
    return this.as(caller, ["admin"], (acting) =>
      replaceHandoffContacts(this.database, acting, input),
    );
  }

  async refreshWhatsappTemplates(caller: Caller) {
    return this.asThenArm(caller, ["admin"], () =>
      refreshWhatsappTemplates(this.database, this.whatsapp),
    );
  }
}
