import type { CommunicationRulesInput } from "#/lib/communication-rules.ts";
import type {
  LateReplyReference,
  PersonalReply,
  ReturnTimeInput,
} from "#/lib/conversation-holds.ts";
import type { HandoffContactsInput } from "#/lib/handoff-contacts.ts";
import type {
  HandoffReference,
  HandoffRemindersInput,
  OpenHandoffListOptions,
} from "#/lib/handoffs.ts";
import type { SandboxStart, SandboxTurnInput } from "#/lib/assistant-sandbox.ts";
import type { SignupCompletion } from "#/lib/whatsapp.ts";
import type {
  ConversationReference,
  MessageReference,
  WhatsappEvents,
} from "#/lib/whatsapp-messages.ts";
import type { TemplateCreate, TemplateDelete, TemplateEdit } from "#/lib/whatsapp-templates.ts";

import {
  listSandboxScenarios,
  runSandboxTurn,
  startSandbox,
} from "#/organization/assistant-sandbox.ts";
import type { SandboxTurnsRunning } from "#/organization/assistant-sandbox.ts";
import { saveCommunicationRules } from "#/organization/communication-rules.ts";
import { openMessageMedia } from "#/organization/conversation-media.ts";
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
  passHandoffToPractitioner,
} from "#/organization/handoff-inbox.ts";
import { withdrawOwnLateReply } from "#/organization/late-replies.ts";
import { patientEditors } from "#/organization/members.ts";
import type { Caller } from "#/organization/members.ts";
import { OrganizationRuntime } from "#/organization/organization-runtime.ts";
import { organizationIdIn } from "#/organization/whatsapp-connection.ts";
import { storeWhatsappEvents } from "#/organization/whatsapp-messages.ts";
import { getWhatsappSettings } from "#/organization/whatsapp.ts";
import { createTemplate, deleteTemplate, editTemplate } from "#/organization/templates.ts";
import { refreshWhatsappTemplates } from "#/organization/whatsapp-templates.ts";

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

  /** Drops the reply the clinical check held on a handoff the member sees. */
  dropHeldReply(caller: Caller, input: HandoffReference) {
    return this.as(caller, patientEditors, (acting) =>
      dropHandoffHeldReply(this.database, acting, input),
    );
  }

  /** Passes a handoff to reception to the practitioner: its new recipients' reminders wake the alarm. */
  passToPractitioner(caller: Caller, input: HandoffReference) {
    return this.asThenArm(caller, patientEditors, (acting) =>
      passHandoffToPractitioner(this.database, acting, input),
    );
  }

  /** A patient's photo, video, file or voice note in a conversation the member reads, streamed from Meta. */
  openMessageMedia(caller: Caller, input: MessageReference, range: string | null) {
    return this.as(caller, patientEditors, (acting) =>
      openMessageMedia(this.database, this.whatsapp, acting, input, range),
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

  returnConversation(caller: Caller, input: ConversationReference) {
    return this.asThenArm(caller, patientEditors, (acting) =>
      returnConversation(this.database, acting, input),
    );
  }

  /** Withdraws the member's own reply that waits behind the reopen template (`src/organization/late-replies.ts`). */
  withdrawLateReply(caller: Caller, input: LateReplyReference) {
    // A template dropped with it no longer wakes the alarm.
    return this.asThenArm(caller, patientEditors, (acting) =>
      withdrawOwnLateReply(this.database, acting, input),
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

  async createTemplate(caller: Caller, input: TemplateCreate) {
    return this.asThenArm(caller, ["admin"], (acting) =>
      createTemplate(this.database, this.whatsapp, acting, input),
    );
  }

  /** A template's text, and for the organization's own its name and timing, which can queue messages. */
  async editTemplate(caller: Caller, input: TemplateEdit) {
    return this.asThenArm(caller, ["admin"], (acting) =>
      editTemplate(this.database, this.whatsapp, acting, input),
    );
  }

  deleteTemplate(caller: Caller, input: TemplateDelete) {
    return this.as(caller, ["admin"], (acting) => deleteTemplate(this.database, acting, input));
  }

  /** The assistant's `vos` or `usted` and tone (#185), which the settings read back. */
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
