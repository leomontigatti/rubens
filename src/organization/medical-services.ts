import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { changedFields, createdFields } from "#/lib/audit-fields.ts";
import {
  medicalServiceActiveChangeSchema,
  medicalServiceInputSchema,
  medicalServiceUpdateSchema,
} from "#/lib/medical-services.ts";
import type {
  MedicalServiceActiveChange,
  MedicalServiceInput,
  MedicalServiceUpdate,
  Reminder,
} from "#/lib/medical-services.ts";
import { flattenCareInstructions } from "#/lib/template-filling.ts";
import { maxCareInstructionsLength, whatsappTemplates } from "#/lib/whatsapp-templates.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { approvedVersion } from "#/organization/outbox.ts";
import { findPractitioner } from "#/organization/practitioners.ts";
import { medicalService, medicalServiceReminder } from "#/organization/schema.ts";

// Practitioners' medical services. Everyone reads them, since booking picks
// from them; an admin changes anyone's and a practitioner their own (the
// object refuses a receptionist first). Nothing is deleted: a deactivated one
// drops out of the booking list and stays on the medical services screen.
// Every change is written to the audit log, about no patient. Each one also
// sets its patient messages (`docs/domain/messages.md` § To patients).

export interface MedicalService {
  id: string;
  name: string;
  durationMinutes: number;
  bookingConfirmation: boolean;
  /** Latest first. */
  reminders: Reminder[];
  careInstructions: string | null;
  followUpHours: number | null;
  rescheduleCutoffHours: number;
  active: boolean;
}

type Refusal = "forbidden" | "invalidInput" | "notFound" | "practitionerInactive";

/** Care instructions longer than the `indicaciones` template has room for, once flattened. */
interface CareInstructionsTooLong {
  ok: false;
  reason: "careInstructionsTooLong";
  maxLength: number;
}

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const practitionerInactive = { ok: false, reason: "practitionerInactive" } as const;

const medicalServiceColumns = {
  id: medicalService.id,
  name: medicalService.name,
  durationMinutes: medicalService.durationMinutes,
  bookingConfirmation: medicalService.bookingConfirmation,
  careInstructions: medicalService.careInstructions,
  followUpHours: medicalService.followUpHours,
  rescheduleCutoffHours: medicalService.rescheduleCutoffHours,
  active: medicalService.active,
};

/** The reminders of each of `ids`, latest first. */
function remindersOf(database: Database, ids: string[]) {
  const rows = database
    .select({
      medicalServiceId: medicalServiceReminder.medicalServiceId,
      hoursBefore: medicalServiceReminder.hoursBefore,
      asksToConfirm: medicalServiceReminder.asksToConfirm,
    })
    .from(medicalServiceReminder)
    .where(inArray(medicalServiceReminder.medicalServiceId, ids))
    .orderBy(desc(medicalServiceReminder.hoursBefore))
    .all();
  const byService = new Map<string, Reminder[]>(ids.map((id) => [id, []]));
  for (const { medicalServiceId, ...reminder } of rows) {
    byService.get(medicalServiceId)!.push(reminder);
  }
  return byService;
}

function withReminders<T extends { id: string }>(database: Database, rows: T[]) {
  const reminders = remindersOf(
    database,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, reminders: reminders.get(row.id)! }));
}

function saveReminders(tx: Database, medicalServiceId: string, reminders: Reminder[]) {
  tx.delete(medicalServiceReminder)
    .where(eq(medicalServiceReminder.medicalServiceId, medicalServiceId))
    .run();
  if (reminders.length > 0) {
    tx.insert(medicalServiceReminder)
      .values(reminders.map((reminder) => ({ ...reminder, medicalServiceId })))
      .run();
  }
}

function careInstructionsMaxLength(database: Database) {
  return maxCareInstructionsLength(
    approvedVersion(database, "indicaciones")?.body ?? whatsappTemplates.indicaciones.draft,
  );
}

/**
 * The refusal for care instructions that would not fit the `indicaciones`
 * template as sent: flattened, in the latest approved version's body, or the
 * doc's draft while none is approved.
 */
function careInstructionsTooLong(
  database: Database,
  careInstructions: string | null,
): CareInstructionsTooLong | null {
  if (!careInstructions) {
    return null;
  }
  const maxLength = careInstructionsMaxLength(database);
  return flattenCareInstructions(careInstructions).length > maxLength
    ? { ok: false, reason: "careInstructionsTooLong", maxLength }
    : null;
}

/** The fields as the audit log keeps them: the reminders as one value. */
function audited<T extends { reminders: Reminder[] }>(fields: T) {
  return { ...fields, reminders: JSON.stringify(fields.reminders) };
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
  /** The longest care instructions the `indicaciones` template has room for, flattened. */
  careInstructionsMaxLength: number;
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
    medicalServices: withReminders(database, rows),
    canEdit: found.canEdit && found.active,
    careInstructionsMaxLength: careInstructionsMaxLength(database),
  };
}

export function createMedicalService(
  database: Database,
  acting: Acting,
  input: MedicalServiceInput,
): Result<{ medicalService: MedicalService }> | CareInstructionsTooLong {
  const parsed = medicalServiceInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { reminders, ...fields } = parsed.data;
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
    const tooLong = careInstructionsTooLong(tx, fields.careInstructions);
    if (tooLong) {
      return tooLong;
    }
    const created = tx.insert(medicalService).values(fields).returning(medicalServiceColumns).get();
    saveReminders(tx, created.id, reminders);
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "medicalService",
      entityId: created.id,
      patientId: null,
      before: null,
      after: createdFields(audited(parsed.data)),
    });
    return { ok: true as const, medicalService: { ...created, reminders } };
  });
}

export function updateMedicalService(
  database: Database,
  acting: Acting,
  input: MedicalServiceUpdate,
): Result<{ medicalService: MedicalService }> | CareInstructionsTooLong {
  const parsed = medicalServiceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { medicalServiceId, reminders, ...fields } = parsed.data;
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
    // Checked only when changed: an approved template can leave less room
    // than saved instructions had, which must not block the service's other edits.
    const tooLong =
      fields.careInstructions !== current.careInstructions &&
      careInstructionsTooLong(tx, fields.careInstructions);
    if (tooLong) {
      return tooLong;
    }
    const [before] = withReminders(tx, [current]);
    const updated = tx
      .update(medicalService)
      .set(fields)
      .where(eq(medicalService.id, medicalServiceId))
      .returning(medicalServiceColumns)
      .get();
    saveReminders(tx, medicalServiceId, reminders);
    const changed = changedFields(audited(before!), audited({ ...fields, reminders }));
    if (changed) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "medicalService",
        entityId: medicalServiceId,
        patientId: null,
        ...changed,
      });
    }
    return { ok: true as const, medicalService: { ...updated, reminders } };
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
