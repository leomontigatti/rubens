import { and, asc, eq } from "drizzle-orm";

import { appointmentType } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import {
  appointmentTypeActiveChangeSchema,
  appointmentTypeInputSchema,
  appointmentTypeUpdateSchema,
} from "#/lib/appointment-types.ts";
import type {
  AppointmentTypeActiveChange,
  AppointmentTypeColor,
  AppointmentTypeInput,
  AppointmentTypeUpdate,
} from "#/lib/appointment-types.ts";

import { changedFields, createdFields, recordAudit } from "#/server/audit.ts";
import { findPractitioner } from "#/server/schedules.ts";

// Practitioners' appointment types. Everyone reads them, since booking picks
// from them; an admin changes anyone's and a practitioner their own. Nothing is
// deleted: a deactivated type drops out of the booking list and stays on the
// types screen. Every change is written to the audit log, about no patient.
// `database` is for tests, which pass a transaction running as the app role.

export interface AppointmentType {
  id: string;
  name: string;
  durationMinutes: number;
  color: AppointmentTypeColor;
  active: boolean;
}

type Refusal = "forbidden" | "invalidInput" | "notFound" | "practitionerInactive";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const practitionerInactive = { ok: false, reason: "practitionerInactive" } as const;

/** Whether the actor may change types at all, before any row is read. */
function mayEditSome(actor: Actor): boolean {
  return actor.roles.includes("admin") || actor.roles.includes("practitioner");
}

const appointmentTypeColumns = {
  id: appointmentType.id,
  name: appointmentType.name,
  durationMinutes: appointmentType.durationMinutes,
  color: appointmentType.color,
  active: appointmentType.active,
};

export interface AppointmentTypeListOptions {
  practitionerId: string;
  /** The types screen shows deactivated types; booking does not. */
  includeInactive: boolean;
}

/** A practitioner's types, by name, and whether the actor may change them. */
export async function listAppointmentTypes(
  actor: Actor,
  options: AppointmentTypeListOptions,
  database?: AnyDatabase,
): Promise<
  Result<{
    practitioner: { id: string; displayName: string; canEdit: boolean; active: boolean };
    appointmentTypes: AppointmentType[];
    canEdit: boolean;
  }>
> {
  const parsed = appointmentTypeInputSchema.shape.practitionerId.safeParse(options.practitionerId);
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
        .select(appointmentTypeColumns)
        .from(appointmentType)
        .where(
          and(
            eq(appointmentType.practitionerId, found.id),
            options.includeInactive ? undefined : eq(appointmentType.active, true),
          ),
        )
        .orderBy(asc(appointmentType.name));
      return {
        ok: true as const,
        practitioner: {
          id: found.id,
          displayName: found.displayName,
          canEdit: found.canEdit,
          active: found.active,
        },
        appointmentTypes: rows,
        canEdit: found.canEdit && found.active,
      };
    },
    database,
  );
}

export async function createAppointmentType(
  actor: Actor,
  input: AppointmentTypeInput,
  database?: AnyDatabase,
): Promise<Result<{ appointmentType: AppointmentType }>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = appointmentTypeInputSchema.safeParse(input);
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
        .insert(appointmentType)
        .values({ ...parsed.data, organizationId: actor.organizationId })
        .returning(appointmentTypeColumns);
      await recordAudit(tx, actor, {
        action: "create",
        entityType: "appointmentType",
        entityId: created!.id,
        patientId: null,
        before: null,
        after: createdFields(parsed.data),
      });
      return { ok: true as const, appointmentType: created! };
    },
    database,
  );
}

export async function updateAppointmentType(
  actor: Actor,
  input: AppointmentTypeUpdate,
  database?: AnyDatabase,
): Promise<Result<{ appointmentType: AppointmentType }>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = appointmentTypeUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { appointmentTypeId, ...fields } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const [current] = await tx
        .select({ ...appointmentTypeColumns, practitionerId: appointmentType.practitionerId })
        .from(appointmentType)
        .where(eq(appointmentType.id, appointmentTypeId))
        .for("update");
      if (!current) {
        return notFound;
      }
      const found = await findPractitioner(tx, actor, current.practitionerId, false);
      if (!found?.canEdit) {
        return forbidden;
      }
      const [updated] = await tx
        .update(appointmentType)
        .set(fields)
        .where(eq(appointmentType.id, appointmentTypeId))
        .returning(appointmentTypeColumns);
      const changed = changedFields(current, fields);
      if (changed) {
        await recordAudit(tx, actor, {
          action: "update",
          entityType: "appointmentType",
          entityId: appointmentTypeId,
          patientId: null,
          ...changed,
        });
      }
      return { ok: true as const, appointmentType: updated! };
    },
    database,
  );
}

export async function setAppointmentTypeActive(
  actor: Actor,
  input: AppointmentTypeActiveChange,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!mayEditSome(actor)) {
    return forbidden;
  }
  const parsed = appointmentTypeActiveChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { id, active } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const [current] = await tx
        .select({ active: appointmentType.active, practitionerId: appointmentType.practitionerId })
        .from(appointmentType)
        .where(eq(appointmentType.id, id))
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
      await tx.update(appointmentType).set({ active }).where(eq(appointmentType.id, id));
      await recordAudit(tx, actor, {
        action: active ? "reactivate" : "deactivate",
        entityType: "appointmentType",
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
