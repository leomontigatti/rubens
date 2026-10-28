import { and, asc, eq } from "drizzle-orm";

import { insurer } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase } from "#/db/tenant.ts";
import type { Actor, Role } from "#/lib/access.ts";
import {
  insurerActiveChangeSchema,
  insurerInputSchema,
  insurerUpdateSchema,
} from "#/lib/coverages.ts";
import type {
  InsurerActiveChange,
  InsurerInput,
  InsurerKind,
  InsurerUpdate,
} from "#/lib/coverages.ts";

import { changedFields, createdFields, recordAudit } from "#/server/audit.ts";

// The organization's list of insurers, which coverages are picked from. Only
// an admin changes it; everyone who edits patients reads it. Nothing is
// deleted: a deactivated insurer drops out of the default list and stays on
// the coverages that have it. Every change is written to the audit log, about
// no patient. `database` is for tests, which pass a transaction running as the
// app role.

export interface Insurer {
  id: string;
  name: string;
  kind: InsurerKind;
  active: boolean;
}

type Refusal = "forbidden" | "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

const readerRoles: readonly Role[] = ["admin", "receptionist", "practitioner"];

function canRead(actor: Actor): boolean {
  return actor.roles.some((role) => readerRoles.includes(role));
}

function isAdmin(actor: Actor): boolean {
  return actor.roles.includes("admin");
}

const insurerColumns = {
  id: insurer.id,
  name: insurer.name,
  kind: insurer.kind,
  active: insurer.active,
};

export interface InsurerListOptions {
  includeInactive: boolean;
}

export async function listInsurers(
  actor: Actor,
  options: InsurerListOptions,
  database?: AnyDatabase,
): Promise<Result<{ insurers: Insurer[] }>> {
  if (!canRead(actor)) {
    return forbidden;
  }
  return withTenant(
    actor,
    async (tx) => {
      const rows = await tx
        .select(insurerColumns)
        .from(insurer)
        .where(options.includeInactive ? undefined : eq(insurer.active, true))
        .orderBy(asc(insurer.name));
      return { ok: true as const, insurers: rows };
    },
    database,
  );
}

export async function createInsurer(
  actor: Actor,
  input: InsurerInput,
  database?: AnyDatabase,
): Promise<Result<{ insurer: Insurer }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = insurerInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const [created] = await tx
        .insert(insurer)
        .values({ ...parsed.data, organizationId: actor.organizationId })
        .returning(insurerColumns);
      await recordAudit(tx, actor, {
        action: "create",
        entityType: "insurer",
        entityId: created!.id,
        patientId: null,
        before: null,
        after: createdFields(parsed.data),
      });
      return { ok: true as const, insurer: created! };
    },
    database,
  );
}

export async function updateInsurer(
  actor: Actor,
  input: InsurerUpdate,
  database?: AnyDatabase,
): Promise<Result<{ insurer: Insurer }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = insurerUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { insurerId, ...fields } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const [current] = await tx
        .select(insurerColumns)
        .from(insurer)
        .where(eq(insurer.id, insurerId));
      if (!current) {
        return notFound;
      }
      const [updated] = await tx
        .update(insurer)
        .set(fields)
        .where(eq(insurer.id, insurerId))
        .returning(insurerColumns);
      const changed = changedFields(current, fields);
      if (changed) {
        await recordAudit(tx, actor, {
          action: "update",
          entityType: "insurer",
          entityId: insurerId,
          patientId: null,
          ...changed,
        });
      }
      return { ok: true as const, insurer: updated! };
    },
    database,
  );
}

export async function setInsurerActive(
  actor: Actor,
  input: InsurerActiveChange,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = insurerActiveChangeSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { id, active } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const updated = await tx
        .update(insurer)
        .set({ active })
        .where(and(eq(insurer.id, id), eq(insurer.active, !active)))
        .returning({ id: insurer.id });
      if (updated.length === 0) {
        // Already in the state asked for, or not there at all.
        const [found] = await tx.select({ id: insurer.id }).from(insurer).where(eq(insurer.id, id));
        return found ? { ok: true as const } : notFound;
      }
      await recordAudit(tx, actor, {
        action: active ? "reactivate" : "deactivate",
        entityType: "insurer",
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
