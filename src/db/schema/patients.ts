import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "#/db/schema/auth.ts";
import { rubens, timestamps } from "#/db/schema/schema.ts";

// Tenant-owned: row-level security on `organization_id` is enabled and forced
// in the migration (raw SQL, 0007), as for every table with that column.

export const documentType = rubens.enum("document_type", ["dni", "passport", "other"]);

/** A patient (ui: "Paciente") of the organization's one registry. Never deleted. */
export const patient = rubens.table(
  "patient",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    chosenName: text("chosen_name"),
    documentType: documentType("document_type"),
    documentNumber: text("document_number"),
    // A local date. No birth date is what makes a patient incomplete.
    birthDate: date("birth_date"),
    /** E.164, as `src/lib/phones.ts` reads it. */
    phone: text("phone").notNull(),
    email: text("email"),
    address: text("address"),
    whatsappConsent: boolean("whatsapp_consent").notNull().default(true),
    // When and by whom consent was last given: at registration, or when
    // turned back on. A user id, kept without a key like the audit log's.
    whatsappConsentAt: timestamp("whatsapp_consent_at", { withTimezone: true }).notNull(),
    whatsappConsentBy: text("whatsapp_consent_by").notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("patient_organization_id_idx").on(table.organizationId),
    // A document belongs to one patient of the organization; the services
    // match this name to refuse a repeated one.
    uniqueIndex("patient_document_unique")
      .on(table.organizationId, table.documentType, table.documentNumber)
      .where(sql`${table.documentNumber} is not null`),
    check(
      "patient_document_check",
      sql`(${table.documentType} is null) = (${table.documentNumber} is null)`,
    ),
    // The target of the composite keys later tables (the audit log, coverages,
    // guardians) point at.
    unique().on(table.id, table.organizationId),
  ],
);

/**
 * The append-only audit log (ADR-0003): one row per change, written in the
 * change's transaction by `recordAudit` (`src/server/audit.ts`). The app role
 * may only insert and read it (migration 0007).
 */
export const auditLog = rubens.table(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    // The acting user's id. No key: an entry outlives anything it names.
    userId: text("user_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    // The patient the entry is about, so a patient's history includes the
    // changes to their coverages and guardians; null for entries about no
    // patient (an insurer).
    patientId: uuid("patient_id"),
    // The changed fields only: their values before and after the change.
    before: jsonb("before").$type<Record<string, string | number | boolean | null>>(),
    after: jsonb("after").$type<Record<string, string | number | boolean | null>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_patient_id_idx").on(table.patientId, table.createdAt),
    // A key check bypasses row-level security, so the patient is matched with
    // the organization too.
    foreignKey({
      name: "audit_log_patient_fk",
      columns: [table.patientId, table.organizationId],
      foreignColumns: [patient.id, patient.organizationId],
    }),
  ],
);
