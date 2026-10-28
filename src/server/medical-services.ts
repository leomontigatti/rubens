import { and, asc, eq } from "drizzle-orm";

import { medicalService } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import {
  medicalServiceActiveChangeSchema,
  medicalServiceInputSchema,
  medicalServiceUpdateSchema,
} from "#/lib/medical-services.ts";
import type {
  MedicalServiceActiveChange,
  MedicalServiceColor,
  MedicalServiceInput,
  MedicalServiceUpdate,
} from "#/lib/medical-services.ts";

import { changedFields, createdFields, recordAudit } from "#/server/audit.ts";
import { findPractitioner } from "#/server/schedules.ts";

// Practitioners' medical services. Everyone reads them, since booking picks
// from them; an admin changes anyone's and a practitioner their own. Nothing is
// deleted: a deactivated one drops out of the booking list and stays on the
// medical services screen. Every change is written to the audit log, about no patient.
// `database` is for tests, which pass a transaction running as the app role.

export interface MedicalService {
  id: string;
  name: string;
  durationMinutes: number;
  color: MedicalServiceColor;
  active: boolean;
}

type Refusal = "forbidden" | "invalidInput" | "notFound" | "practitionerInactive";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const practitionerInactive = { ok: false, reason: "practitionerInactive" } as const;

/** Whether the actor may change medical services at all, before any row is read. */
function mayEditSome(actor: Actor): boolean {
  return actor.roles.includes("admin") || actor.roles.includes("practitioner");
}

const medicalServiceColumns = {
  id: medicalService.id,
  name: medicalService.name,
  durationMinutes: medicalService.durationMinutes,
  color: medicalService.color,
  active: medicalService.active,
};

export interface MedicalServiceListOptions {
  practitionerId: string;
  /** The medical services screen shows deactivated ones; booking does not. */
  includeInactive: boolean;
}

/** A practitioner's medical services, by name, and whether the actor may change them. */
export async function listMedicalServices(
  actor: Actor,
  options: MedicalServiceListOptions,
  database?: AnyDatabase,
): Promise<
  Result<{
    practitioner: { id: string; displayName: string; canEdit: boolean; active: boolean };
    medicalServices: MedicalService[];
    canEdit: boolean;
  }>
> {
  const parsed = medicalServiceInputSchema.shape.practitionerId.safeParse(options.practitionerId);
  if (!parsed.success) {
    return notFound;
  }
  return withTenant(
    actor,
    async (tx) => {
      const found = await findPractitioner(tx, actor, parsed.data, false);
      if (!found) {
        return notFound;
      }
      const rows = await tx
        .select(medicalServiceColumns)
        .from(medicalService)
        .where(
          and(
            eq(medicalService.practitionerId, found.id),
            options.includeInactive ? undefined : eq(medicalService.active, true),
          ),
        )
        .orderBy(asc(medicalService.name));
      return {
        ok: true as const,
        practitioner: {
          id: found.id,
          displayName: found.displayName,
          canEdit: found.canEdit,
          active: found.active,
        },
        medicalServices: rows,
        canEdit: found.canEdit && found.active,
      };
    },
    database,
  );
}

export async function createMedicalService(
  actor: Actor,
  input: MedicalServiceInput,
  database?: AnyDatabase,
): Promise<Result<{ medicalService: MedicalService }>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = medicalServiceInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const found = await findPractitioner(tx, actor, parsed.data.practitionerId, false);
      if (!found) {
        return notFound;
      }
      if (!found.canEdit) {
        return forbidden;
      }
      if (!found.active) {
        return practitionerInactive;
      }
      const [created] = await tx
        .insert(medicalService)
        .values({ ...parsed.data, organizationId: actor.organizationId })
        .returning(medicalServiceColumns);
      await recordAudit(tx, actor, {
        action: "create",
        entityType: "medicalService",
        entityId: created!.id,
        patientId: null,
        before: null,
        after: createdFields(parsed.data),
      });
      return { ok: true as const, medicalService: created! };
    },
    database,
  );
}

export async function updateMedicalService(
  actor: Actor,
  input: MedicalServiceUpdate,
  database?: AnyDatabase,
): Promise<Result<{ medicalService: MedicalService }>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = medicalServiceUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { medicalServiceId, ...fields } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const [current] = await tx
        .select({ ...medicalServiceColumns, practitionerId: medicalService.practitionerId })
        .from(medicalService)
        .where(eq(medicalService.id, medicalServiceId))
        .for("update");
      if (!current) {
        return notFound;
      }
      const found = await findPractitioner(tx, actor, current.practitionerId, false);
      if (!found?.canEdit) {
        return forbidden;
      }
      const [updated] = await tx
        .update(medicalService)
        .set(fields)
        .where(eq(medicalService.id, medicalServiceId))
        .returning(medicalServiceColumns);
      const changed = changedFields(current, fields);
      if (changed) {
        await recordAudit(tx, actor, {
          action: "update",
          entityType: "medicalService",
          entityId: medicalServiceId,
          patientId: null,
          ...changed,
        });
      }
      return { ok: true as const, medicalService: updated! };
    },
    database,
  );
}

export async function setMedicalServiceActive(
  actor: Actor,
  input: MedicalServiceActiveChange,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = medicalServiceActiveChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { id, active } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const [current] = await tx
        .select({ active: medicalService.active, practitionerId: medicalService.practitionerId })
        .from(medicalService)
        .where(eq(medicalService.id, id))
        .for("update");
      if (!current) {
        return notFound;
      }
      const found = await findPractitioner(tx, actor, current.practitionerId, false);
      if (!found?.canEdit) {
        return forbidden;
      }
      if (current.active === active) {
        return { ok: true as const };
      }
      await tx.update(medicalService).set({ active }).where(eq(medicalService.id, id));
      await recordAudit(tx, actor, {
        action: active ? "reactivate" : "deactivate",
        entityType: "medicalService",
        entityId: id,
        patientId: null,
        before: { active: !active },
        after: { active },
      });
      return { ok: true as const };
    },
    database,
  );
}
