import type { CommunicationRulesInput } from "#/lib/communication-rules.ts";
import type { PersonalReply, ReturnTimeInput } from "#/lib/conversation-holds.ts";
import type { HandoffContactsInput } from "#/lib/handoff-contacts.ts";
import type {
  HandoffReference,
  HandoffRemindersInput,
  OpenHandoffListOptions,
} from "#/lib/handoffs.ts";
import type { SandboxStart, SandboxTurnInput } from "#/lib/assistant-sandbox.ts";
import type { SignupCompletion, TemplateSend } from "#/lib/whatsapp.ts";
import type { ConversationReference, WhatsappEvents } from "#/lib/whatsapp-messages.ts";
import type { TemplateSubmission } from "#/lib/whatsapp-templates.ts";

import {
  listSandboxScenarios,
  runSandboxTurn,
  startSandbox,
} from "#/organization/assistant-sandbox.ts";
import type { SandboxTurnsRunning } from "#/organization/assistant-sandbox.ts";
import { saveCommunicationRules } from "#/organization/communication-rules.ts";
import {
  replyToConversation,
  returnConversation,
  saveReturnTime,
  takeOverConversation,
} from "#/organization/conversation-holds.ts";
import { listHandoffContacts, replaceHandoffContacts } from "#/organization/handoff-contacts.ts";
import { saveHandoffReminders } from "#/organization/handoff-countdown.ts";
import {
  closeHandoffWithoutReply,
  dropHandoffHeldReply,
  listOpenHandoffs,
} from "#/organization/handoff-inbox.ts";
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
  /** The sandbox turns running now, held against the sandbox's hourly limit. */
  readonly #sandboxTurns: SandboxTurnsRunning = { count: 0 };

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

  /** Drops the reply the clinical check held on a handoff the member is a recipient of. */
  dropHeldReply(caller: Caller, input: HandoffReference) {
    return this.as(caller, patientEditors, (acting) =>
      dropHandoffHeldReply(this.database, acting, input),
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

  /** How many hours before the window closes a handoff's reminders go: the alarm is set after it. */
  saveHandoffReminders(caller: Caller, input: HandoffRemindersInput) {
    return this.asThenArm(caller, ["admin"], (acting) =>
      saveHandoffReminders(this.database, acting, input),
    );
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

  /** The upcoming appointments the assistant's sandbox can start from (#183). */
  sandboxScenarios(caller: Caller) {
    return this.as(caller, ["admin"], () => listSandboxScenarios(this.database));
  }

  /** A sandbox conversation from the scenario's reminder; nothing is stored. */
  startSandbox(caller: Caller, input: SandboxStart) {
    return this.as(caller, ["admin"], () => startSandbox(this.database, input));
  }

  /** The assistant's turn on the patient's message the admin wrote: its writes are discarded. */
  async sandboxTurn(caller: Caller, input: SandboxTurnInput) {
    return this.as(caller, ["admin"], () =>
      runSandboxTurn(this.database, this.assistant, this.#sandboxTurns, input),
    );
  }
}
