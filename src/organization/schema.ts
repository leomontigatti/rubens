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

import type { Role } from "#/lib/access.ts";
import { appointmentCancellers, appointmentStatuses } from "#/lib/appointments.ts";
import { insurerKinds } from "#/lib/coverages.ts";
import { outboxDropReasons, outboxKinds, outboxStates } from "#/lib/outbox.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { practitionerColors } from "#/lib/practitioner-colors.ts";
import { whatsappMessageDirections, whatsappMessageStatuses } from "#/lib/whatsapp-messages.ts";
import { templateNames, templateStatuses } from "#/lib/whatsapp-templates.ts";

// The organization object's SQLite schema (ADR-0008). Everything in it belongs
// to the one organization the object is, so no table carries an organization
// id: the object is the tenant boundary. Instants are integers, Unix
// milliseconds UTC; a span is `[startsAt, endsAt)`. Local times (`HH:MM`) and
// local dates (`YYYY-MM-DD`) are text, read in an office's IANA zone.
//
// After editing this file, run `pnpm organization:generate`, which adds a
// migration; a migration on `main` has run in deployed objects and is never edited.

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const instant = (name: string) => integer(name, { mode: "number" });

const flag = (name: string) => integer(name, { mode: "boolean" });

const timestamps = {
  createdAt: instant("created_at")
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: instant("updated_at")
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdateFn(() => Date.now()),
};

/** The organization itself: one row, written by the setup. */
export const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamps.createdAt,
});

/**
 * A member of the organization's staff (ui: "Personal"), keyed by the sign-in
 * provider's user id. The object authorizes every call from this row, never
 * from the roles a session token claims (#131).
 */
export const member = sqliteTable(
  "member",
  {
    userId: text("user_id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    roles: text("roles", { mode: "json" }).$type<Role[]>().notNull(),
    active: flag("active").notNull().default(true),
    // Held on the change-password screen until they replace the starting
    // password; mirrored to the Clerk user's public metadata.
    mustChangePassword: flag("must_change_password").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("member_email_unique").on(sql`lower(${table.email})`),
    // SQLite allows no subquery in a check, so the role names themselves are
    // the object's to validate (`insertMember`).
    check("member_roles_check", sql`json_array_length(${table.roles}) >= 1`),
  ],
);

// One row per member who holds, or once held, the practitioner role: removing
// the role keeps the row for history.
export const practitioner = sqliteTable(
  "practitioner",
  {
    id: id(),
    memberId: text("member_id")
      .notNull()
      .unique()
      .references(() => member.userId),
    displayName: text("display_name").notNull(),
    specialty: text("specialty"),
    keepsClinicalRecords: flag("keeps_clinical_records").notNull().default(true),
    // Free times start every this many minutes, counted from local midnight.
    gridMinutes: integer("grid_minutes").notNull().default(30),
    // The colour of their appointments on the calendar.
    color: text("color", { enum: practitionerColors }).notNull().default("color1"),
    ...timestamps,
  },
  (table) => [
    check("practitioner_grid_minutes_check", sql`${table.gridMinutes} between 5 and 120`),
  ],
);

export const office = sqliteTable("office", {
  id: id(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  timeZone: text("time_zone").notNull().default(defaultTimeZone),
  active: flag("active").notNull().default(true),
  ...timestamps,
});

export const room = sqliteTable(
  "room",
  {
    id: id(),
    officeId: text("office_id")
      .notNull()
      .references(() => office.id),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull().default(1),
    active: flag("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("room_office_id_idx").on(table.officeId),
    check("room_capacity_check", sql`${table.capacity} >= 1`),
  ],
);

// A set of weekdays with times and validity dates (ADR-0003): the times are
// wall-clock times in the room's office's time zone, the dates local dates there.
export const schedule = sqliteTable(
  "schedule",
  {
    id: id(),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioner.id),
    roomId: text("room_id")
      .notNull()
      .references(() => room.id),
    /** ISO weekdays: 1 is Monday, 7 is Sunday. */
    weekdays: text("weekdays", { mode: "json" }).$type<number[]>().notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    firstDate: text("first_date").notNull(),
    lastDate: text("last_date"),
    ...timestamps,
  },
  (table) => [
    index("schedule_practitioner_id_idx").on(table.practitionerId),
    index("schedule_room_id_idx").on(table.roomId),
    check("schedule_weekdays_check", sql`json_array_length(${table.weekdays}) >= 1`),
    check("schedule_times_check", sql`${table.startTime} < ${table.endTime}`),
    check(
      "schedule_dates_check",
      sql`${table.lastDate} is null or ${table.lastDate} >= ${table.firstDate}`,
    ),
  ],
);

/** A practitioner's time off (ui: "Licencia"). Time off and closures may overlap freely. */
export const timeOff = sqliteTable(
  "time_off",
  {
    id: id(),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioner.id),
    startsAt: instant("starts_at").notNull(),
    endsAt: instant("ends_at").notNull(),
    ...timestamps,
  },
  (table) => [
    index("time_off_practitioner_id_idx").on(table.practitionerId, table.startsAt),
    check("time_off_span_check", sql`${table.startsAt} < ${table.endsAt}`),
  ],
);

/** A closure (ui: "Cierre") of one office, or of the whole organization when `officeId` is null. */
export const closure = sqliteTable(
  "closure",
  {
    id: id(),
    officeId: text("office_id").references(() => office.id),
    startsAt: instant("starts_at").notNull(),
    endsAt: instant("ends_at").notNull(),
    ...timestamps,
  },
  (table) => [
    index("closure_office_id_idx").on(table.officeId, table.startsAt),
    check("closure_span_check", sql`${table.startsAt} < ${table.endsAt}`),
  ],
);

export const documentTypes = ["dni", "passport", "other"] as const;

/** A patient (ui: "Paciente") of the organization's one registry. Never deleted. */
export const patient = sqliteTable(
  "patient",
  {
    id: id(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    chosenName: text("chosen_name"),
    // The names the search box matches, normalized, written with them by the
    // object (`src/organization/patient-search.ts`): SQLite has no `unaccent`.
    searchName: text("search_name").notNull(),
    documentType: text("document_type", { enum: documentTypes }),
    documentNumber: text("document_number"),
    // A local date. No birth date is what makes a patient incomplete.
    birthDate: text("birth_date"),
    /** E.164, as `src/lib/phones.ts` reads it. */
    phone: text("phone").notNull(),
    email: text("email"),
    address: text("address"),
    whatsappConsent: flag("whatsapp_consent").notNull().default(true),
    // When and by whom consent was last given: at registration, or when
    // turned back on. A user id, kept without a key like the audit log's.
    whatsappConsentAt: instant("whatsapp_consent_at").notNull(),
    whatsappConsentBy: text("whatsapp_consent_by").notNull(),
    active: flag("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    // A document belongs to one patient; the object refuses a repeated one.
    uniqueIndex("patient_document_unique")
      .on(table.documentType, table.documentNumber)
      .where(sql`${table.documentNumber} is not null`),
    check(
      "patient_document_check",
      sql`(${table.documentType} is null) = (${table.documentNumber} is null)`,
    ),
  ],
);

/**
 * The append-only audit log (ADR-0003): one row per change, written in the
 * change's transaction by `recordAudit` (`src/organization/audit.ts`). No code
 * path updates or deletes a row (ADR-0008).
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    // The acting user's id. No key: an entry outlives anything it names.
    userId: text("user_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    // The patient the entry is about, so a patient's history includes the
    // changes to their coverages and guardians; null for entries about no
    // patient (an insurer). No key either, for the same reason.
    patientId: text("patient_id"),
    // The changed fields only: their values before and after the change.
    before: text("before", { mode: "json" }).$type<
      Record<string, string | number | boolean | null>
    >(),
    after: text("after", { mode: "json" }).$type<
      Record<string, string | number | boolean | null>
    >(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("audit_log_patient_id_idx").on(table.patientId, table.createdAt)],
);

/** An `obra social` or `prepaga` (ui: "Obra social / prepaga") on the organization's list. */
export const insurer = sqliteTable(
  "insurer",
  {
    id: id(),
    name: text("name").notNull(),
    kind: text("kind", { enum: insurerKinds }).notNull(),
    // A deactivated insurer is offered for no new coverage, and stays on the
    // coverages that have it.
    active: flag("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    // One insurer per name, whatever its case; the object refuses a repeat
    // before it reaches this index.
    uniqueIndex("insurer_name_unique").on(sql`lower(${table.name})`),
  ],
);

/** A patient's membership of an insurer (ui: "Cobertura"). */
export const coverage = sqliteTable(
  "coverage",
  {
    id: id(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patient.id),
    insurerId: text("insurer_id")
      .notNull()
      .references(() => insurer.id),
    plan: text("plan"),
    memberNumber: text("member_number").notNull(),
    primary: flag("primary").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("coverage_patient_id_idx").on(table.patientId),
    // At most one primary coverage per patient; the object moves the flag.
    uniqueIndex("coverage_primary_unique")
      .on(table.patientId)
      .where(sql`${table.primary}`),
  ],
);

/**
 * A contact kept on a patient (ui: "Responsable"), usually a minor's parent.
 * Not a link to another patient, even when they are one.
 */
export const guardian = sqliteTable(
  "guardian",
  {
    id: id(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patient.id),
    name: text("name").notNull(),
    relationship: text("relationship").notNull(),
    documentType: text("document_type", { enum: documentTypes }),
    documentNumber: text("document_number"),
    /** E.164, as `src/lib/phones.ts` reads it. */
    phone: text("phone").notNull(),
    email: text("email"),
    // Whether messages to the patient go to this guardian. With none flagged
    // they go to the patient's own phone, so removing the guardian falls back.
    messageContact: flag("message_contact").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("guardian_patient_id_idx").on(table.patientId),
    // At most one of a patient's guardians is their message contact.
    uniqueIndex("guardian_message_contact_unique")
      .on(table.patientId)
      .where(sql`${table.messageContact}`),
    check(
      "guardian_document_check",
      sql`(${table.documentType} is null) = (${table.documentNumber} is null)`,
    ),
  ],
);

/** A kind of visit a practitioner offers (ui: "Prestación"). */
export const medicalService = sqliteTable(
  "medical_service",
  {
    id: id(),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioner.id),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    // Whether booking one of its appointments sends the patient the booking
    // confirmation (`docs/domain/messages.md`).
    bookingConfirmation: flag("booking_confirmation").notNull().default(true),
    // A medical service in use is deactivated, never deleted: it drops out of
    // booking and stays on its appointments.
    active: flag("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("medical_service_practitioner_id_idx").on(table.practitionerId),
    // The bounds of `durationMinutesSchema`.
    check(
      "medical_service_duration_minutes_check",
      sql`${table.durationMinutes} between 1 and 720`,
    ),
  ],
);

/**
 * A patient's booked time with one practitioner (ui: "Turno"). SQLite has no
 * exclusion constraints: the object checks both overlap rules of ADR-0003 and
 * writes the row in one synchronous transaction (ADR-0008). The two
 * `(…, starts_at)` indexes are what those checks read.
 */
export const appointment = sqliteTable(
  "appointment",
  {
    id: id(),
    patientId: text("patient_id")
      .notNull()
      .references(() => patient.id),
    practitionerId: text("practitioner_id")
      .notNull()
      .references(() => practitioner.id),
    medicalServiceId: text("medical_service_id")
      .notNull()
      .references(() => medicalService.id),
    roomId: text("room_id")
      .notNull()
      .references(() => room.id),
    startsAt: instant("starts_at").notNull(),
    endsAt: instant("ends_at").notNull(),
    status: text("status", { enum: appointmentStatuses }).notNull().default("booked"),
    /** An overbooking: booked on purpose over another appointment or outside the schedules. */
    overbooking: flag("overbooking").notNull().default(false),
    cancelledBy: text("cancelled_by", { enum: appointmentCancellers }),
    cancellationReason: text("cancellation_reason"),
    receptionNote: text("reception_note"),
    // For the same-day undo of a status change.
    previousStatus: text("previous_status", { enum: appointmentStatuses }),
    statusChangedAt: instant("status_changed_at")
      .notNull()
      .$defaultFn(() => Date.now()),
    // A user id, kept without a key like the audit log's.
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    index("appointment_patient_id_idx").on(table.patientId, table.startsAt),
    index("appointment_practitioner_starts_at_idx").on(table.practitionerId, table.startsAt),
    index("appointment_room_starts_at_idx").on(table.roomId, table.startsAt),
    check("appointment_span_check", sql`${table.startsAt} < ${table.endsAt}`),
    check("appointment_reception_note_check", sql`length(${table.receptionNote}) <= 200`),
    check(
      "appointment_cancelled_check",
      sql`(${table.status} = 'cancelled') = (${table.cancelledBy} is not null)`,
    ),
  ],
);

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
