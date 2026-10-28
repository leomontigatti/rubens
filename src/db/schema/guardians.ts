import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { organization } from "#/db/schema/auth.ts";
import { documentType, patient } from "#/db/schema/patients.ts";
import { rubens, timestamps } from "#/db/schema/schema.ts";

// Tenant-owned: row-level security on `organization_id` is enabled and forced
// in the migration (raw SQL, 0010), as for every table with that column.

/**
 * A contact kept on a patient (ui: "Responsable"), usually a minor's parent.
 * Not a link to another patient, even when they are one.
 */
export const guardian = rubens.table(
  "guardian",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    patientId: uuid("patient_id").notNull(),
    name: text("name").notNull(),
    relationship: text("relationship").notNull(),
    documentType: documentType("document_type"),
    documentNumber: text("document_number"),
    /** E.164, as `src/lib/phones.ts` reads it. */
    phone: text("phone").notNull(),
    email: text("email"),
    // Whether messages to the patient go to this guardian. With none flagged
    // they go to the patient's own phone, so removing the guardian falls back.
    messageContact: boolean("message_contact").notNull().default(false),
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
    // A key check bypasses row-level security, so the patient is matched with
    // the organization too.
    foreignKey({
      name: "guardian_patient_fk",
      columns: [table.patientId, table.organizationId],
      foreignColumns: [patient.id, patient.organizationId],
    }),
  ],
);
