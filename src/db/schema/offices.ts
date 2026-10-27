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

import { defaultTimeZone } from "#/lib/offices.ts";

import { organization } from "#/db/schema/auth.ts";
import { rubens, timestamps } from "#/db/schema/schema.ts";

// Tenant-owned: row-level security on `organization_id` is enabled and forced
// in the migration (raw SQL, 0003), as for every table with that column.
export const office = rubens.table(
  "office",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    address: text("address").notNull(),
    timeZone: text("time_zone").notNull().default(defaultTimeZone),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("office_organization_id_idx").on(table.organizationId),
    // The target of the room's composite key below.
    unique().on(table.id, table.organizationId),
  ],
);

export const room = rubens.table(
  "room",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    officeId: uuid("office_id").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull().default(1),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("room_office_id_idx").on(table.officeId),
    // A key check bypasses row-level security, so the room's office must be
    // matched with the organization too: a room can never sit in another
    // organization's office.
    foreignKey({
      columns: [table.officeId, table.organizationId],
      foreignColumns: [office.id, office.organizationId],
    }),
    check("room_capacity_check", sql`${table.capacity} >= 1`),
  ],
);
