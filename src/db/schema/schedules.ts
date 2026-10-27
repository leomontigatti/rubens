import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, text, time, uuid } from "drizzle-orm/pg-core";

import { organization } from "#/db/schema/auth.ts";
import { room } from "#/db/schema/offices.ts";
import { rubens, timestamps } from "#/db/schema/schema.ts";
import { practitioner } from "#/db/schema/staff.ts";

// Tenant-owned: row-level security on `organization_id` is enabled and forced
// in the migration (raw SQL, 0005), as for every table with that column.
// A weekly RRULE with validity dates (ADR-0003): the times are wall-clock times
// in the room's office's time zone, the dates local dates there.
export const schedule = rubens.table(
  "schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    practitionerId: uuid("practitioner_id").notNull(),
    roomId: uuid("room_id").notNull(),
    /** ISO weekdays: 1 is Monday, 7 is Sunday. */
    weekdays: integer("weekdays").array().notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    firstDate: date("first_date").notNull(),
    lastDate: date("last_date"),
    ...timestamps,
  },
  (table) => [
    index("schedule_practitioner_id_idx").on(table.practitionerId),
    index("schedule_room_id_idx").on(table.roomId),
    // Key checks bypass row-level security, so the practitioner and the room
    // are matched with the organization too.
    foreignKey({
      name: "schedule_practitioner_fk",
      columns: [table.practitionerId, table.organizationId],
      foreignColumns: [practitioner.id, practitioner.organizationId],
    }),
    foreignKey({
      name: "schedule_room_fk",
      columns: [table.roomId, table.organizationId],
      foreignColumns: [room.id, room.organizationId],
    }),
    check(
      "schedule_weekdays_check",
      sql`cardinality(${table.weekdays}) >= 1 and ${table.weekdays} <@ array[1,2,3,4,5,6,7]`,
    ),
    check("schedule_times_check", sql`${table.startTime} < ${table.endTime}`),
    check(
      "schedule_dates_check",
      sql`${table.lastDate} is null or ${table.lastDate} >= ${table.firstDate}`,
    ),
  ],
);
