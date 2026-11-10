import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { modelRunPurposes } from "#/lib/assistant.ts";
import { formsOfAddress } from "#/lib/communication-rules.ts";
import { lateReplyStates } from "#/lib/conversation-holds.ts";
import { defaultHandoffReminders, handoffReasons, handoffStates } from "#/lib/handoffs.ts";
import { outboxDropReasons, outboxKinds, outboxStates } from "#/lib/outbox.ts";
import { proposalKinds } from "#/lib/proposals.ts";
import {
  messageJudgements,
  whatsappMessageDirections,
  whatsappMessageStatuses,
} from "#/lib/whatsapp-messages.ts";
import { connectionStates, numberHoldReasons } from "#/lib/whatsapp.ts";
import { templateCategories, templateNames, templateStatuses } from "#/lib/whatsapp-templates.ts";

import { appointment, member, patient } from "#/organization/schema.ts";
import { flag, id, instant, timestamps } from "#/organization/schema-columns.ts";

// The organization object's WhatsApp tables (ADR-0010), beside the rest of its
// schema in `schema.ts`, whose rules they follow.

/**
 * The WhatsApp conversation with one number (ADR-0010): every message to and
 * from it, whichever patients it stands for. The number is E.164, as
 * `src/lib/phones.ts` writes a patient's or a guardian's phone.
 */
export const conversation = sqliteTable("conversation", {
  id: id(),
  phone: text("phone").notNull().unique(),
  /**
   * When the assistant's wait ends and its turn runs (docs/domain/assistant.md
   * § Pace): set by each incoming message, so a burst gets one turn; none
   * while no message waits for it.
   */
  assistantDueAt: instant("assistant_due_at"),
  /**
   * How many of the patient's turns in a row the assistant misunderstood
   * (assistant.md § Handoff): the second hands the conversation off.
   */
  misunderstandings: integer("misunderstandings").notNull().default(0),
  /**
   * How many turns in a row the model could not read the patient's messages
   * (assistant.md § The conversation window): each failure waits longer
   * before the next retry (`src/organization/turn-retries.ts`).
   */
  failedTurns: integer("failed_turns").notNull().default(0),
  /**
   * The member who took the conversation over from the inbox
   * (`src/organization/conversation-holds.ts`), while the assistant stays
   * silent in it; none while the assistant holds it.
   */
  heldBy: text("held_by").references(() => member.userId),
  /** When it goes back to the assistant on its own, while a member holds it. */
  heldUntil: instant("held_until"),
  ...timestamps,
});

/**
 * The patients a conversation's number is the message contact of
 * (`docs/domain/assistant.md`), kept current by each incoming message and by
 * each change to a patient's phone or message contact: a guardian's number
 * can stand for several, and an unknown number for none.
 */
export const conversationPatient = sqliteTable(
  "conversation_patient",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id),
    patientId: text("patient_id")
      .notNull()
      .references(() => patient.id),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.patientId] }),
    index("conversation_patient_patient_id_idx").on(table.patientId),
  ],
);

/**
 * One WhatsApp message in a conversation, unique by Meta's message id, so a
 * webhook call Meta repeats stores nothing twice.
 */
export const whatsappMessage = sqliteTable(
  "whatsapp_message",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id),
    /** Meta's id for the message (`wamid.…`). */
    whatsappId: text("whatsapp_id").notNull().unique(),
    direction: text("direction", { enum: whatsappMessageDirections }).notNull(),
    /** Meta's message type: `text`, `image`, `audio`, … */
    type: text("type").notNull(),
    /**
     * A text message's body, or a voice note's transcript once it is
     * transcribed (empty when nobody could understand it, `voice-notes.ts`);
     * other types keep theirs in `payload`.
     */
    text: text("text"),
    /** The message as Meta sent it, JSON: a voice note's media id, and the rest for the types nothing reads yet. */
    payload: text("payload").notNull(),
    /** When Meta says it was sent. */
    sentAt: instant("sent_at").notNull(),
    // An outgoing message's latest status and when Meta says it happened;
    // statuses can arrive out of order, so an older one does not replace it.
    status: text("status", { enum: whatsappMessageStatuses }),
    statusAt: instant("status_at"),
    /** An incoming message's judgement; none until the assistant judges it. */
    judgement: text("judgement", { enum: messageJudgements }),
    /** Whether the assistant judged an incoming message an emergency; none until it judges it. */
    emergency: flag("emergency"),
    /** The communication rules' version an assistant reply was written under; none for other messages. */
    rulesVersion: integer("rules_version"),
    /** The member whose reply from the inbox it is; none for the assistant's and the templates. */
    sentBy: text("sent_by").references(() => member.userId),
    ...timestamps,
  },
  (table) => [index("whatsapp_message_conversation_idx").on(table.conversationId, table.sentAt)],
);

/**
 * One version of a WhatsApp template the organization submitted to Meta
 * (`docs/operations/whatsapp-templates.md`): underthing's name for it, and the
 * body as submitted. Each version is its own template at Meta, named by its
 * version, so a row is never resubmitted; only Meta's verdict on it changes.
 */
export const whatsappTemplate = sqliteTable(
  "whatsapp_template",
  {
    id: id(),
    name: text("name", { enum: templateNames }).notNull(),
    version: integer("version").notNull(),
    /** Meta's language code, such as `es_AR`. */
    language: text("language").notNull(),
    body: text("body").notNull(),
    /** Meta's id for the template. */
    metaId: text("meta_id").notNull().unique(),
    status: text("status", { enum: templateStatuses }).notNull(),
    /** Meta's reason for a rejection, such as `INVALID_FORMAT`. */
    rejectionReason: text("rejection_reason"),
    // Submitted as utility; Meta can move it to another category after approving it.
    category: text("category", { enum: templateCategories }).notNull().default("utility"),
    // Raised by every status write, so a refresh that read Meta before a
    // webhook event does not write over it.
    statusRevision: integer("status_revision").notNull().default(0),
    /** The admin who submitted it. */
    submittedBy: text("submitted_by").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("whatsapp_template_name_version_idx").on(table.name, table.version)],
);

/**
 * The organization's WhatsApp number, as Embedded Signup connected it
 * (`src/organization/whatsapp-connection.ts`): one row at most. The token and
 * the PIN are sealed with the organization's key (`src/organization/encryption.ts`),
 * never stored in clear, and dropped when the number is disconnected.
 */
export const whatsappConnection = sqliteTable(
  "whatsapp_connection",
  {
    // Always 1: an organization connects one number.
    id: integer("id").primaryKey(),
    businessAccountId: text("business_account_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    /** As Meta formats it, such as `+54 9 351 555-0100`. */
    displayNumber: text("display_number").notNull(),
    /** Meta's messaging limit, such as `TIER_250`. */
    messagingLimit: text("messaging_limit"),
    state: text("state", { enum: connectionStates }).notNull(),
    /** Meta's words on a failed connection. */
    failureReason: text("failure_reason"),
    accessToken: text("access_token"),
    /** The number's two-step verification PIN, set when it was registered. */
    pin: text("pin"),
    /** The admin who connected it. */
    connectedBy: text("connected_by").notNull(),
    ...timestamps,
  },
  (table) => [check("whatsapp_connection_one_row", sql`${table.id} = 1`)],
);

/**
 * Why the organization's number cannot start conversations for now
 * (docs/domain/messages.md § When Meta limits the number): one row at most,
 * until a time or, when `until` is null, until Meta lifts it. It belongs to
 * the account Meta limited, the configured test number's included, so it
 * outlives no change of account.
 */
export const whatsappNumberHold = sqliteTable(
  "whatsapp_number_hold",
  {
    // Always 1: an organization sends from one number.
    id: integer("id").primaryKey(),
    reason: text("reason", { enum: numberHoldReasons }).notNull(),
    until: instant("until"),
    ...timestamps,
  },
  (table) => [check("whatsapp_number_hold_one_row", sql`${table.id} = 1`)],
);

/**
 * A message to a patient, queued in the transaction that changed its
 * appointment and sent by the object's alarm once due (`src/lib/outbox.ts`).
 * Who it goes to and what it says are read when it is sent, from the
 * appointment as it is then; for the reopen template, from its conversation.
 */
export const outboxMessage = sqliteTable(
  "outbox_message",
  {
    id: id(),
    kind: text("kind", { enum: outboxKinds }).notNull(),
    /** The appointment it is about; none for the reopen template. */
    appointmentId: text("appointment_id").references(() => appointment.id),
    /** The conversation the reopen template goes to; none for the other kinds. */
    conversationId: text("conversation_id").references(() => conversation.id),
    state: text("state", { enum: outboxStates }).notNull().default("queued"),
    /** When it goes next, while queued. */
    dueAt: instant("due_at").notNull(),
    // A reminder's hours before the appointment, as its medical service set
    // them when it was queued; null for other kinds. Not the reminder's id,
    // which a save of the medical service replaces.
    hoursBefore: integer("hours_before"),
    attempts: integer("attempts").notNull().default(0),
    dropReason: text("drop_reason", { enum: outboxDropReasons }),
    // Meta's error on the latest failed attempt.
    errorCode: integer("error_code"),
    errorMessage: text("error_message"),
    /** The message as sent, in its conversation. */
    whatsappMessageId: text("whatsapp_message_id").references(() => whatsappMessage.id),
    ...timestamps,
  },
  (table) => [
    index("outbox_message_due_idx").on(table.state, table.dueAt),
    index("outbox_message_appointment_id_idx").on(table.appointmentId),
  ],
);

/**
 * A member's reply written after the conversation's window closed
 * (`src/organization/late-replies.ts`): held until the patient answers the
 * reopen template it waits behind, then sent as they wrote it. The reply
 * never goes into the template.
 */
export const lateReply = sqliteTable(
  "late_reply",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id),
    writtenBy: text("written_by")
      .notNull()
      .references(() => member.userId),
    /** The reply as the patient will read it, under its writer's name. */
    text: text("text").notNull(),
    /** Whether its writer is a practitioner who keeps clinical records, who may answer a clinical handoff. */
    readsClinical: flag("reads_clinical").notNull(),
    /** Whether it answers a clinical handoff, so its words are withheld like clinical ones. */
    clinical: flag("clinical").notNull(),
    /** The patients the number reached when it was written: it goes only while it still reaches each. */
    patientIds: text("patient_ids", { mode: "json" }).$type<string[]>().notNull(),
    state: text("state", { enum: lateReplyStates }).notNull().default("waiting"),
    /** The reopen template it waits behind, which later replies before the patient answers share. */
    reopenId: text("reopen_id")
      .notNull()
      .references(() => outboxMessage.id),
    /** The message it went as, once delivered. */
    whatsappMessageId: text("whatsapp_message_id").references(() => whatsappMessage.id),
    ...timestamps,
  },
  (table) => [index("late_reply_state_idx").on(table.state, table.conversationId)],
);

/**
 * The organization's communication rules for the assistant
 * (`src/organization/communication-rules.ts`): one row at most, none until an
 * admin first saves them. Each save raises `version`, which every assistant
 * reply records.
 */
export const communicationRules = sqliteTable(
  "communication_rules",
  {
    // Always 1: an organization has one set of rules.
    id: integer("id").primaryKey(),
    formOfAddress: text("form_of_address", { enum: formsOfAddress }).notNull(),
    signOff: text("sign_off").notNull(),
    tone: text("tone").notNull(),
    /** The organization's phone, E.164, which the emergency reply gives the patient; empty for none. */
    phone: text("phone").notNull().default(""),
    version: integer("version").notNull(),
    ...timestamps,
  },
  (table) => [check("communication_rules_one_row", sql`${table.id} = 1`)],
);

/**
 * The inbox's settings (`src/organization/conversation-holds.ts`): one row at
 * most, none until an admin first saves them.
 */
export const inboxSettings = sqliteTable(
  "inbox_settings",
  {
    // Always 1: an organization has one inbox.
    id: integer("id").primaryKey(),
    /** How long a member holds a conversation they took over before it goes back to the assistant. */
    returnAfterHours: integer("return_after_hours").notNull(),
    /** How many hours before the window closes a handoff's recipients are reminded of it. */
    handoffReminderHours: integer("handoff_reminder_hours")
      .notNull()
      .default(defaultHandoffReminders.recipientHours),
    /** How many hours before the window closes every other member who may answer a handoff is reminded too. */
    handoffWideReminderHours: integer("handoff_wide_reminder_hours")
      .notNull()
      .default(defaultHandoffReminders.othersHours),
    ...timestamps,
  },
  (table) => [check("inbox_settings_one_row", sql`${table.id} = 1`)],
);

/**
 * A conversation the assistant handed to a person (`src/lib/handoffs.ts`):
 * open until a person's reply reaches the patient, or a person closes it
 * without one. A clinical handoff goes only to practitioners who keep
 * clinical records; anyone else sees that it exists, never its words.
 */
export const handoff = sqliteTable(
  "handoff",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id),
    reason: text("reason", { enum: handoffReasons }).notNull(),
    clinical: flag("clinical").notNull(),
    /** The appointment it concerns, whose practitioner it goes to; none when it concerns none. */
    appointmentId: text("appointment_id").references(() => appointment.id),
    state: text("state", { enum: handoffStates }).notNull().default("open"),
    closedAt: instant("closed_at"),
    /** The member who closed it without a reply. */
    closedBy: text("closed_by").references(() => member.userId),
    /**
     * The assistant's reply the clinical check held unsent, for its
     * recipients to send, fix or drop; none once dropped or the handoff
     * closed, and for other reasons.
     */
    heldReply: text("held_reply"),
    /**
     * Whether it counts back from the window's close with reminders: made
     * inside the window. One made after the close tells the patient nothing.
     */
    countsDown: flag("counts_down").notNull().default(false),
    /** The window's close its recipients were last reminded of; none before the first reminder. */
    remindedFor: instant("reminded_for"),
    /** The window's close every other member who may answer it was last reminded of. */
    widelyRemindedFor: instant("widely_reminded_for"),
    /**
     * On a clinical one, the newest patient message its reader had seen when
     * they reported an opt-out among its words, which reception cannot read:
     * the report covers it and every message before it.
     */
    optOutReportedThrough: text("opt_out_reported_through").references(() => whatsappMessage.id),
    ...timestamps,
  },
  (table) => [index("handoff_conversation_idx").on(table.conversationId, table.state)],
);

/** The members a handoff went to, each told at once by a notification. */
export const handoffRecipient = sqliteTable(
  "handoff_recipient",
  {
    handoffId: text("handoff_id")
      .notNull()
      .references(() => handoff.id),
    memberId: text("member_id")
      .notNull()
      .references(() => member.userId),
  },
  (table) => [
    primaryKey({ columns: [table.handoffId, table.memberId] }),
    index("handoff_recipient_member_idx").on(table.memberId),
  ],
);

/**
 * A change the assistant stated to the patient in full (`src/lib/proposals.ts`):
 * only the conversation's latest can be accepted, once, before it expires.
 * Accepting runs the appointment's own change functions. The patient's own
 * moves of an appointment are its accepted moves.
 */
export const proposal = sqliteTable(
  "proposal",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointment.id),
    kind: text("kind", { enum: proposalKinds }).notNull(),
    /** What the patient was told: the change and the appointment's facts, compared again on the yes. */
    statement: text("statement", { mode: "json" }).$type<Record<string, string>>().notNull(),
    /** A move's new start, one find_free_times offered; none for another kind. */
    startsAt: instant("starts_at"),
    expiresAt: instant("expires_at").notNull(),
    /** When its change was made; none while it waits for its yes, or when it failed. */
    acceptedAt: instant("accepted_at"),
    ...timestamps,
  },
  (table) => [index("proposal_conversation_idx").on(table.conversationId, table.createdAt)],
);

/**
 * What one run of the assistant's model used (docs/domain/assistant.md §
 * Costs): a turn's, or a clinical check's, in the sandbox or not, on the
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

/**
 * A patient held by an opt-out-looking reply (docs/domain/patients.md §
 * WhatsApp consent): while the row exists, nothing the organization starts
 * goes to them, and reception is reminded daily to turn them off or keep
 * them. Deciding either way deletes it (`src/organization/opt-out-holds.ts`).
 */
export const optOutHold = sqliteTable("opt_out_hold", {
  patientId: text("patient_id")
    .primaryKey()
    .references(() => patient.id),
  /** When reception and the admins are next reminded. */
  remindAt: instant("remind_at").notNull(),
  createdAt: timestamps.createdAt,
});
