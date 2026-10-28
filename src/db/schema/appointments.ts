import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { medicalServiceColors } from "#/lib/medical-services.ts";
import { appointmentCancellers, appointmentStatuses } from "#/lib/appointments.ts";

import { organization } from "#/db/schema/auth.ts";
import { room } from "#/db/schema/offices.ts";
import { patient } from "#/db/schema/patients.ts";
import { rubens, timeRange, timestamps } from "#/db/schema/schema.ts";
import { practitioner } from "#/db/schema/staff.ts";

// Tenant-owned: row-level security on `organization_id` is enabled and forced
// in the migrations (raw SQL, 0012 and 0013), as for every table with that column.

export const medicalServiceColor = rubens.enum("medical_service_color", medicalServiceColors);

/** A kind of visit a practitioner offers (ui: "Prestación"). */
export const medicalService = rubens.table(
  "medical_service",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    practitionerId: uuid("practitioner_id").notNull(),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    color: medicalServiceColor("color").notNull(),
    // A medical service in use is deactivated, never deleted: it drops out of booking and
    // stays on its appointments.
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("medical_service_practitioner_id_idx").on(table.practitionerId),
    // The target of the appointment's composite key.
    unique().on(table.id, table.organizationId),
    // A key check bypasses row-level security, so the practitioner is matched
    // with the organization too.
    foreignKey({
      name: "medical_service_practitioner_fk",
      columns: [table.practitionerId, table.organizationId],
      foreignColumns: [practitioner.id, practitioner.organizationId],
    }),
    // The bounds of `durationMinutesSchema`.
    check(
      "medical_service_duration_minutes_check",
      sql`${table.durationMinutes} between 1 and 720`,
    ),
  ],
);

export const appointmentStatus = rubens.enum("appointment_status", appointmentStatuses);

export const appointmentCanceller = rubens.enum("appointment_canceller", appointmentCancellers);

/**
 * A patient's booked time with one practitioner (ui: "Turno"). A practitioner
 * never holds two active appointments at once unless one is an overbooking:
 * the exclusion constraint `appointment_practitioner_overlap` is raw SQL in
 * migration 0013, which Drizzle cannot declare.
 */
export const appointment = rubens.table(
  "appointment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    patientId: uuid("patient_id").notNull(),
    practitionerId: uuid("practitioner_id").notNull(),
    medicalServiceId: uuid("medical_service_id").notNull(),
    roomId: uuid("room_id").notNull(),
    during: timeRange("during").notNull(),
    status: appointmentStatus("status").notNull().default("booked"),
    /** An overbooking: booked on purpose over another appointment or outside the schedules. */
    overbooking: boolean("overbooking").notNull().default(false),
    cancelledBy: appointmentCanceller("cancelled_by"),
    cancellationReason: text("cancellation_reason"),
    receptionNote: text("reception_note"),
    // For the same-day undo of a status change.
    previousStatus: appointmentStatus("previous_status"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).defaultNow().notNull(),
    // A user id, kept without a key like the audit log's.
    createdBy: text("created_by").notNull(),
    ...timestamps,
  },
  (table) => [
    index("appointment_patient_id_idx").on(table.patientId),
    index("appointment_room_id_idx").on(table.roomId),
    // Key checks bypass row-level security, so each one is matched with the
    // organization too.
    foreignKey({
      name: "appointment_patient_fk",
      columns: [table.patientId, table.organizationId],
      foreignColumns: [patient.id, patient.organizationId],
    }),
    foreignKey({
      name: "appointment_practitioner_fk",
      columns: [table.practitionerId, table.organizationId],
      foreignColumns: [practitioner.id, practitioner.organizationId],
    }),
    foreignKey({
      name: "appointment_medical_service_fk",
      columns: [table.medicalServiceId, table.organizationId],
      foreignColumns: [medicalService.id, medicalService.organizationId],
    }),
    foreignKey({
      name: "appointment_room_fk",
      columns: [table.roomId, table.organizationId],
      foreignColumns: [room.id, room.organizationId],
    }),
    check(
      "appointment_during_check",
      sql`not isempty(${table.during}) and not lower_inf(${table.during}) and not upper_inf(${table.during})`,
    ),
    check("appointment_reception_note_check", sql`char_length(${table.receptionNote}) <= 200`),
    check(
      "appointment_cancelled_check",
      sql`(${table.status} = 'cancelled') = (${table.cancelledBy} is not null)`,
    ),
  ],
);
