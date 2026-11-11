import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import type { Role } from "#/lib/access.ts";
import { appointmentCancellers, appointmentStatuses } from "#/lib/appointments.ts";
import { insurerKinds } from "#/lib/coverages.ts";
import { notificationKinds } from "#/lib/notifications.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { practitionerColors } from "#/lib/practitioner-colors.ts";

import { flag, id, instant, timestamps } from "#/organization/schema-columns.ts";

// The organization object's SQLite schema (ADR-0008). Everything in it belongs
// to the one organization the object is, so no table carries an organization
// id: the object is the tenant boundary. Instants are integers, Unix
// milliseconds UTC; a span is `[startsAt, endsAt)`. Local times (`HH:MM`) and
// local dates (`YYYY-MM-DD`) are text, read in an office's IANA zone.
//
// The WhatsApp tables are in `whatsapp-schema.ts`. After editing either file,
// run `pnpm organization:generate`, which adds a
// migration; a migration on `main` has run in deployed objects and is never edited.

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
    // Receives the handoffs that concern no particular practitioner
    // (`src/organization/handoff-contacts.ts`).
    handoffContact: flag("handoff_contact").notNull().default(false),
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
    /** Whether the patients it sends to the "to reschedule" list are told by WhatsApp. */
    tellPatients: flag("tell_patients").notNull().default(true),
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
    /** Whether the patients it sends to the "to reschedule" list are told by WhatsApp. */
    tellPatients: flag("tell_patients").notNull().default(true),
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
    // The templates it sends are `medicalServiceTemplate` rows (`whatsapp-schema.ts`).
    // Whole hours, bounded by `src/lib/medical-services.ts`: a check here would rebuild the table.
    rescheduleCutoffHours: integer("reschedule_cutoff_hours").notNull().default(24),
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
 * A notification to one member (`src/lib/notifications.ts`), read or unread.
 * What it is about is kept as it was when it happened: the template and its
 * version, Meta's word (a rejection reason, a category, a limit), until when,
 * and how many messages were waiting then.
 */
export const notification = sqliteTable(
  "notification",
  {
    id: id(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => member.userId),
    kind: text("kind", { enum: notificationKinds }).notNull(),
    // The template it is about (`whatsapp-schema.ts`, which imports this file, so no reference).
    templateId: text("template_id"),
    templateVersion: integer("template_version"),
    detail: text("detail"),
    until: instant("until"),
    waiting: integer("waiting"),
    // The handoff it tells of (`whatsapp-schema.ts`, which imports this file,
    // so no reference is declared here).
    handoffId: text("handoff_id"),
    /** The patient it is about: who asked to stop getting messages, for `optOut`. */
    patientId: text("patient_id").references(() => patient.id),
    // The conversation of a `replyNotDelivered` (`whatsapp-schema.ts`, so no reference, as `handoffId`).
    conversationId: text("conversation_id"),
    readAt: instant("read_at"),
    ...timestamps,
  },
  (table) => [index("notification_recipient_idx").on(table.recipientId, table.createdAt)],
);
