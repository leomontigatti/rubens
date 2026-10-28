import { sql } from "drizzle-orm";
import { boolean, foreignKey, index, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { insurerKinds } from "#/lib/coverages.ts";

import { organization } from "#/db/schema/auth.ts";
import { patient } from "#/db/schema/patients.ts";
import { rubens, timestamps } from "#/db/schema/schema.ts";

// Tenant-owned: row-level security on `organization_id` is enabled and forced
// in the migration (raw SQL, 0009), as for every table with that column.

export const insurerKind = rubens.enum("insurer_kind", insurerKinds);

/** An obra social or prepaga (ui: "Obra social / prepaga") on the organization's list. */
export const insurer = rubens.table(
  "insurer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    kind: insurerKind("kind").notNull(),
    // A deactivated insurer is offered for no new coverage, and stays on the
    // coverages that have it.
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    index("insurer_organization_id_idx").on(table.organizationId),
    // The target of the coverage's composite key.
    unique().on(table.id, table.organizationId),
  ],
);

/** A patient's membership of an insurer (ui: "Cobertura"). */
export const coverage = rubens.table(
  "coverage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id),
    patientId: uuid("patient_id").notNull(),
    insurerId: uuid("insurer_id").notNull(),
    plan: text("plan"),
    memberNumber: text("member_number").notNull(),
    primary: boolean("primary").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("coverage_patient_id_idx").on(table.patientId),
    // At most one primary coverage per patient; the services move the flag.
    uniqueIndex("coverage_primary_unique")
      .on(table.patientId)
      .where(sql`${table.primary}`),
    // A key check bypasses row-level security, so the patient and the insurer
    // are matched with the organization too.
    foreignKey({
      name: "coverage_patient_fk",
      columns: [table.patientId, table.organizationId],
      foreignColumns: [patient.id, patient.organizationId],
    }),
    foreignKey({
      name: "coverage_insurer_fk",
      columns: [table.insurerId, table.organizationId],
      foreignColumns: [insurer.id, insurer.organizationId],
    }),
  ],
);
