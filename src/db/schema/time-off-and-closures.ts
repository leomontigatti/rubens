import { sql } from "drizzle-orm";
import { check, foreignKey, index, text, uuid } from "drizzle-orm/pg-core";

import { organization } from "#/db/schema/auth.ts";
import { office } from "#/db/schema/offices.ts";
import { rubens, timeRange, timestamps } from "#/db/schema/schema.ts";
import { practitioner } from "#/db/schema/staff.ts";

// Tenant-owned: row-level security on `organization_id` is enabled and forced
// in the migration (raw SQL, 0006), as for every table with that column. Time
// off and closures may overlap each other freely.

/** A practitioner's time off (ui: "Licencia"). */
export const timeOff = rubens.table(
  "time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    practitionerId: uuid("practitioner_id").notNull(),
    during: timeRange("during").notNull(),
    ...timestamps,
  },
  (table) => [
    index("time_off_practitioner_id_idx").on(table.practitionerId),
    // Key checks bypass row-level security, so the practitioner is matched
    // with the organization too.
    foreignKey({
      name: "time_off_practitioner_fk",
      columns: [table.practitionerId, table.organizationId],
      foreignColumns: [practitioner.id, practitioner.organizationId],
    }),
    check(
      "time_off_during_check",
      sql`not isempty(${table.during}) and not lower_inf(${table.during}) and not upper_inf(${table.during})`,
    ),
  ],
);

/** A closure (ui: "Cierre") of one office, or of the whole organization when `officeId` is null. */
export const closure = rubens.table(
  "closure",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    officeId: uuid("office_id"),
    during: timeRange("during").notNull(),
    ...timestamps,
  },
  (table) => [
    index("closure_office_id_idx").on(table.officeId),
    foreignKey({
      name: "closure_office_fk",
      columns: [table.officeId, table.organizationId],
      foreignColumns: [office.id, office.organizationId],
    }),
    check(
      "closure_during_check",
      sql`not isempty(${table.during}) and not lower_inf(${table.during}) and not upper_inf(${table.during})`,
    ),
  ],
);
