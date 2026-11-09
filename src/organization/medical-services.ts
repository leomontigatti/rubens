import { and, asc, eq } from "drizzle-orm";

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
} from "#/lib/medical-services.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { findPractitioner } from "#/organization/practitioners.ts";
import { medicalService } from "#/organization/schema.ts";

// Practitioners' medical services. Everyone reads them, since booking picks
// from them; an admin changes anyone's and a practitioner their own (the
// object refuses a receptionist first). Nothing is deleted: a deactivated one
// drops out of the booking list and stays on the medical services screen.
// Every change is written to the audit log, about no patient.

export interface MedicalService {
  id: string;
  name: string;
  durationMinutes: number;
  bookingConfirmation: boolean;
  active: boolean;
}

type Refusal = "forbidden" | "invalidInput" | "notFound" | "practitionerInactive";

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
  active: medicalService.active,
};

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
    medicalServices: rows,
    canEdit: found.canEdit && found.active,
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
    const created = tx
      .insert(medicalService)
      .values(parsed.data)
      .returning(medicalServiceColumns)
      .get();
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "medicalService",
      entityId: created.id,
      patientId: null,
      before: null,
      after: createdFields(parsed.data),
    });
    return { ok: true as const, medicalService: created };
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
  const { medicalServiceId, ...fields } = parsed.data;
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
    const updated = tx
      .update(medicalService)
      .set(fields)
      .where(eq(medicalService.id, medicalServiceId))
      .returning(medicalServiceColumns)
      .get();
    const changed = changedFields(current, fields);
    if (changed) {
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "medicalService",
        entityId: medicalServiceId,
        patientId: null,
        ...changed,
      });
    }
    return { ok: true as const, medicalService: updated };
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
