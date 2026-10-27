import { boolean, foreignKey, text, unique, uuid } from "drizzle-orm/pg-core";

import { member, organization } from "#/db/schema/auth.ts";
import { rubens, timestamps } from "#/db/schema/schema.ts";

// Tenant-owned: row-level security on `organization_id` is enabled and forced
// in the migration (raw SQL, 0004), as for every table with that column.
// One row per member who holds, or once held, the practitioner role: removing
// the role keeps the row for history.
export const practitioner = rubens.table(
  "practitioner",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    memberId: text("member_id").notNull().unique(),
    displayName: text("display_name").notNull(),
    specialty: text("specialty"),
    keepsClinicalRecords: boolean("keeps_clinical_records").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    // The target of the composite keys later tables (schedules, appointments)
    // point at.
    unique("practitioner_id_organization_id_key").on(table.id, table.organizationId),
    // A key check bypasses row-level security, so the member is matched with the
    // organization too: a practitioner can never be another organization's member.
    foreignKey({
      name: "practitioner_member_fk",
      columns: [table.memberId, table.organizationId],
      foreignColumns: [member.id, member.organizationId],
    }),
  ],
);
