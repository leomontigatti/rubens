import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// One organization's clinic data, inside its own Durable Object. No table carries
// `organization_id`: the object is the tenant boundary (rubens uses RLS for that).
// The DDL is `schemaSql` below, applied when the object starts; these declarations
// are what Drizzle queries.

export const office = sqliteTable("office", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull(),
});

/** ui: "Consultorio". Capacity 1 is an exclusive room; more is a shared one. */
export const room = sqliteTable("room", {
  id: text("id").primaryKey(),
  officeId: text("office_id").notNull(),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull(),
});

export const practitioner = sqliteTable("practitioner", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
});

export const patient = sqliteTable("patient", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

/** ui: "Turno". `[startsAt, endsAt)` in epoch milliseconds, UTC. */
export const appointment = sqliteTable(
  "appointment",
  {
    id: text("id").primaryKey(),
    patientId: text("patient_id").notNull(),
    practitionerId: text("practitioner_id").notNull(),
    roomId: text("room_id").notNull(),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    status: text("status").notNull(),
    overbooking: integer("overbooking", { mode: "boolean" }).notNull(),
    remindedAt: integer("reminded_at"),
    createdBy: text("created_by").notNull(),
  },
  (table) => [
    index("appointment_practitioner_idx").on(table.practitionerId, table.startsAt),
    index("appointment_room_idx").on(table.roomId, table.startsAt),
  ],
);

/** Reminders still to send; the object's single alarm is set to the earliest. */
export const reminder = sqliteTable("reminder", {
  appointmentId: text("appointment_id").primaryKey(),
  dueAt: integer("due_at").notNull(),
});

export const schemaVersion = 1;

export const schemaSql = `
CREATE TABLE IF NOT EXISTS office (id TEXT PRIMARY KEY, name TEXT NOT NULL, time_zone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS room (id TEXT PRIMARY KEY, office_id TEXT NOT NULL REFERENCES office(id), name TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS practitioner (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patient (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS appointment (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patient(id),
  practitioner_id TEXT NOT NULL REFERENCES practitioner(id),
  room_id TEXT NOT NULL REFERENCES room(id),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','confirmed','checkedIn','attended','noShow','cancelled')),
  overbooking INTEGER NOT NULL DEFAULT 0,
  reminded_at INTEGER,
  created_by TEXT NOT NULL,
  -- A medical service lasts 1 to 720 minutes in rubens; the bound keeps the overlap lookups on the index.
  CHECK (starts_at < ends_at AND ends_at - starts_at <= 43200000)
);
CREATE INDEX IF NOT EXISTS appointment_practitioner_idx ON appointment (practitioner_id, starts_at);
CREATE INDEX IF NOT EXISTS appointment_room_idx ON appointment (room_id, starts_at);
CREATE TABLE IF NOT EXISTS reminder (appointment_id TEXT PRIMARY KEY REFERENCES appointment(id), due_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS reminder_due_idx ON reminder (due_at);
`;
