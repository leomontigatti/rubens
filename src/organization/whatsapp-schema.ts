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

import { outboxDropReasons, outboxKinds, outboxStates } from "#/lib/outbox.ts";
import {
  messageJudgements,
  whatsappMessageDirections,
  whatsappMessageStatuses,
} from "#/lib/whatsapp-messages.ts";
import { connectionStates, numberHoldReasons } from "#/lib/whatsapp.ts";
import { templateCategories, templateNames, templateStatuses } from "#/lib/whatsapp-templates.ts";

import { appointment, patient } from "#/organization/schema.ts";
import { id, instant, timestamps } from "#/organization/schema-columns.ts";

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
  ...timestamps,
});

/**
 * The patients a conversation's number is the message contact of
 * (`docs/domain/assistant.md`), as of its latest incoming message: a
 * guardian's number can stand for several, and an unknown number for none.
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
    /** A text message's body; other types keep theirs in `payload`. */
    text: text("text"),
    /** The message as Meta sent it, JSON, for the types nothing reads yet. */
    payload: text("payload").notNull(),
    /** When Meta says it was sent. */
    sentAt: instant("sent_at").notNull(),
    // An outgoing message's latest status and when Meta says it happened;
    // statuses can arrive out of order, so an older one does not replace it.
    status: text("status", { enum: whatsappMessageStatuses }),
    statusAt: instant("status_at"),
    /** An incoming message's judgement; none until the assistant judges it. */
    judgement: text("judgement", { enum: messageJudgements }),
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
 * appointment as it is then.
 */
export const outboxMessage = sqliteTable(
  "outbox_message",
  {
    id: id(),
    kind: text("kind", { enum: outboxKinds }).notNull(),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointment.id),
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
