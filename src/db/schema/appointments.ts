import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { appointmentTypeColors } from "#/lib/appointment-types.ts";

import { organization } from "#/db/schema/auth.ts";
import { rubens, timestamps } from "#/db/schema/schema.ts";
import { practitioner } from "#/db/schema/staff.ts";

// Tenant-owned: row-level security on `organization_id` is enabled and forced
// in the migration (raw SQL, 0012), as for every table with that column.

export const appointmentTypeColor = rubens.enum("appointment_type_color", appointmentTypeColors);

/** A kind of visit a practitioner offers (ui: "Tipo de turno"). */
export const appointmentType = rubens.table(
  "appointment_type",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    practitionerId: uuid("practitioner_id").notNull(),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    color: appointmentTypeColor("color").notNull(),
    // A type in use is deactivated, never deleted: it drops out of booking and
    // stays on its appointments.
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("appointment_type_practitioner_id_idx").on(table.practitionerId),
    // The target of the appointment's composite key.
    unique().on(table.id, table.organizationId),
    // A key check bypasses row-level security, so the practitioner is matched
    // with the organization too.
    foreignKey({
      name: "appointment_type_practitioner_fk",
      columns: [table.practitionerId, table.organizationId],
      foreignColumns: [practitioner.id, practitioner.organizationId],
    }),
    // The bounds of `durationMinutesSchema`.
    check(
      "appointment_type_duration_minutes_check",
      sql`${table.durationMinutes} between 1 and 720`,
    ),
  ],
);
