import { and, asc, eq, inArray, notInArray } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import {
  maxReminders,
  medicalServiceActiveChangeSchema,
  medicalServiceInputSchema,
  medicalServiceUpdateSchema,
} from "#/lib/medical-services.ts";
import type {
  MedicalServiceActiveChange,
  MedicalServiceInput,
  MedicalServiceUpdate,
} from "#/lib/medical-services.ts";
import { timingOf, timingRank } from "#/lib/template-timing.ts";
import type { Timing } from "#/lib/template-timing.ts";
import { eventTemplateIds } from "#/lib/whatsapp-templates.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { findPractitioner } from "#/organization/practitioners.ts";
import { medicalService } from "#/organization/schema.ts";
import { rebuildPicks } from "#/organization/template-messages.ts";
import {
  medicalServiceTemplate,
  template,
  whatsappTemplate,
} from "#/organization/whatsapp-schema.ts";

// Practitioners' medical services. Everyone reads them, since booking picks
// from them; an admin changes anyone's and a practitioner their own (the
// object refuses a receptionist first). Nothing is deleted: a deactivated one
// drops out of the booking list and stays on the medical services screen.
// Every change is written to the audit log, about no patient. Each one also
// picks the organization's templates its appointments get
// (`docs/domain/messages.md` § The organization's templates).

export interface MedicalService {
  id: string;
  name: string;
  durationMinutes: number;
  /** The organization's templates it sends. */
  templateIds: string[];
  rescheduleCutoffHours: number;
  active: boolean;
}

type Refusal =
  | "forbidden"
  | "invalidInput"
  | "notFound"
  | "practitionerInactive"
  | "unknownTemplate"
  | "tooManyReminders";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const practitionerInactive = { ok: false, reason: "practitionerInactive" } as const;
const unknownTemplate = { ok: false, reason: "unknownTemplate" } as const;
const tooManyReminders = { ok: false, reason: "tooManyReminders" } as const;

const medicalServiceColumns = {
  id: medicalService.id,
  name: medicalService.name,
  durationMinutes: medicalService.durationMinutes,
  rescheduleCutoffHours: medicalService.rescheduleCutoffHours,
  active: medicalService.active,
};

/** The templates each of `ids` picks. */
function picksOf(database: Database, ids: string[]) {
  const rows = database
    .select({
      medicalServiceId: medicalServiceTemplate.medicalServiceId,
      templateId: medicalServiceTemplate.templateId,
    })
    .from(medicalServiceTemplate)
    .where(inArray(medicalServiceTemplate.medicalServiceId, ids))
    .all();
  const byService = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const { medicalServiceId, templateId } of rows) {
    byService.get(medicalServiceId)!.push(templateId);
  }
  return byService;
}

function withPicks<T extends { id: string }>(database: Database, rows: T[]) {
  const picks = picksOf(
    database,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, templateIds: picks.get(row.id)! }));
}

/**
 * The organization's own templates a medical service can pick, in the order
 * their messages go, each marked when it has a version that goes now
 * (`approvedVersion`).
 */
function pickableTemplates(database: Database) {
  const approved = new Set(
    database
      .selectDistinct({ id: whatsappTemplate.templateId })
      .from(whatsappTemplate)
      .where(and(eq(whatsappTemplate.status, "approved"), eq(whatsappTemplate.category, "utility")))
      .all()
      .map((row) => row.id),
  );
  return database
    .select({
      id: template.id,
      name: template.name,
      timing: template.timing,
      timingHours: template.timingHours,
    })
    .from(template)
    .where(notInArray(template.id, [...eventTemplateIds]))
    .all()
    .map(({ id, name, ...stored }) => ({
      id,
      name,
      timing: timingOf(stored)!,
      approved: approved.has(id),
    }))
    .sort((a, b) => {
      const [x, y] = [timingRank(a.timing), timingRank(b.timing)];
      return x[0] - y[0] || x[1] - y[1] || a.name.localeCompare(b.name, "es");
    });
}

/** Why `templateIds` cannot be picked: one is no organization template, or too many are reminders. */
function picksRefusal(tx: Database, templateIds: string[]) {
  const pickable = new Map(pickableTemplates(tx).map((one) => [one.id, one]));
  if (!templateIds.every((id) => pickable.has(id))) {
    return unknownTemplate;
  }
  const reminders = templateIds.filter((id) => pickable.get(id)!.timing.when === "before");
  return reminders.length > maxReminders ? tooManyReminders : null;
}

/** Makes `templateIds` the templates `medicalServiceId` picks, and rebuilds the messages the change affects. */
function savePicks(
  tx: Database,
  medicalServiceId: string,
  before: string[],
  templateIds: string[],
) {
  const removed = before.filter((id) => !templateIds.includes(id));
  const added = templateIds.filter((id) => !before.includes(id));
  if (removed.length > 0) {
    tx.delete(medicalServiceTemplate)
      .where(
        and(
          eq(medicalServiceTemplate.medicalServiceId, medicalServiceId),
          inArray(medicalServiceTemplate.templateId, removed),
        ),
      )
      .run();
  }
  // A row per insert, as `notify` inserts: the object's SQLite binds at most 100 parameters a query.
  for (const templateId of added) {
    tx.insert(medicalServiceTemplate).values({ medicalServiceId, templateId }).run();
  }
  rebuildPicks(tx, medicalServiceId, { removed, added });
}

/** The fields as the audit log keeps them: the templates as one value, in a stable order. */
function audited<T extends { templateIds: string[] }>(fields: T) {
  return { ...fields, templateIds: JSON.stringify([...fields.templateIds].sort()) };
}

export interface MedicalServiceListOptions {
  practitionerId: string;
  /** The medical services screen shows deactivated ones; booking does not. */
  includeInactive: boolean;
}

/** A practitioner's medical services, by name, and whether `acting` may change them. */
export function listMedicalServices(
  database: Database,
  acting: Acting,
  options: MedicalServiceListOptions,
): Result<{
  practitioner: { id: string; displayName: string; canEdit: boolean; active: boolean };
  medicalServices: MedicalService[];
  canEdit: boolean;
  /** The organization's own templates its medical services can pick. */
  templates: { id: string; name: string; timing: Timing; approved: boolean }[];
}> {
  const found = findPractitioner(database, acting, options.practitionerId);
  if (!found) {
    return notFound;
  }
  const rows = database
    .select(medicalServiceColumns)
    .from(medicalService)
    .where(
      and(
        eq(medicalService.practitionerId, found.id),
        options.includeInactive ? undefined : eq(medicalService.active, true),
      ),
    )
    .orderBy(asc(medicalService.name))
    .all();
  return {
    ok: true,
    practitioner: {
      id: found.id,
      displayName: found.displayName,
      canEdit: found.canEdit,
      active: found.active,
    },
    medicalServices: withPicks(database, rows),
    canEdit: found.canEdit && found.active,
    templates: pickableTemplates(database),
  };
}

export function createMedicalService(
  database: Database,
  acting: Acting,
  input: MedicalServiceInput,
): Result<{ medicalService: MedicalService }> {
  const parsed = medicalServiceInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { templateIds, ...fields } = parsed.data;
  return database.transaction((tx) => {
    const found = findPractitioner(tx, acting, parsed.data.practitionerId);
    if (!found) {
      return notFound;
    }
    if (!found.canEdit) {
      return forbidden;
    }
    if (!found.active) {
      return practitionerInactive;
    }
    const refusal = picksRefusal(tx, templateIds);
    if (refusal) {
      return refusal;
    }
    const created = tx.insert(medicalService).values(fields).returning(medicalServiceColumns).get();
    savePicks(tx, created.id, [], templateIds);
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "medicalService",
      entityId: created.id,
      patientId: null,
      before: null,
      after: createdFields(audited(parsed.data)),
    });
    return { ok: true as const, medicalService: { ...created, templateIds } };
  });
}

export function updateMedicalService(
  database: Database,
  acting: Acting,
  input: MedicalServiceUpdate,
): Result<{ medicalService: MedicalService }> {
  const parsed = medicalServiceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { medicalServiceId, templateIds, ...fields } = parsed.data;
  return database.transaction((tx) => {
    const current = tx
      .select({ ...medicalServiceColumns, practitionerId: medicalService.practitionerId })
      .from(medicalService)
      .where(eq(medicalService.id, medicalServiceId))
      .get();
    if (!current) {
      return notFound;
    }
    if (!findPractitioner(tx, acting, current.practitionerId)?.canEdit) {
      return forbidden;
    }
    const refusal = picksRefusal(tx, templateIds);
    if (refusal) {
      return refusal;
    }
    const [before] = withPicks(tx, [current]);
    const updated = tx
      .update(medicalService)
      .set(fields)
      .where(eq(medicalService.id, medicalServiceId))
      .returning(medicalServiceColumns)
      .get();
    savePicks(tx, medicalServiceId, before!.templateIds, templateIds);
    const changed = changedFields(audited(before!), audited({ ...fields, templateIds }));
    if (changed) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "medicalService",
        entityId: medicalServiceId,
        patientId: null,
        ...changed,
      });
    }
    return { ok: true as const, medicalService: { ...updated, templateIds } };
  });
}

export function setMedicalServiceActive(
  database: Database,
  acting: Acting,
  input: MedicalServiceActiveChange,
): Result<object> {
  const parsed = medicalServiceActiveChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { id, active } = parsed.data;
  return database.transaction((tx) => {
    const current = tx
      .select({ active: medicalService.active, practitionerId: medicalService.practitionerId })
      .from(medicalService)
      .where(eq(medicalService.id, id))
      .get();
    if (!current) {
      return notFound;
    }
    if (!findPractitioner(tx, acting, current.practitionerId)?.canEdit) {
      return forbidden;
    }
    if (current.active === active) {
      return { ok: true as const };
    }
    tx.update(medicalService).set({ active }).where(eq(medicalService.id, id)).run();
    recordAudit(tx, acting.userId, {
      action: active ? "reactivate" : "deactivate",
      entityType: "medicalService",
      entityId: id,
      patientId: null,
      before: { active: !active },
      after: { active },
    });
    return { ok: true as const };
  });
}
