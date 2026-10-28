import { asc, eq, sql } from "drizzle-orm";

import { closure, office } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase, Transaction } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import {
  closureDeleteSchema,
  closureInputSchema,
  closureUpdateSchema,
  toRangeEntry,
  toTimeRange,
} from "#/lib/time-ranges.ts";
import type { ClosureDelete, ClosureInput, ClosureUpdate, RangeEntry } from "#/lib/time-ranges.ts";

// Closures of one office or the whole organization. Everyone reads them; only
// admins change them. An office's closure is read in that office's zone, the
// organization's in its default zone. Closures may overlap, and they change no
// record of past work, so they can always be edited or deleted. `database` is
// for tests, which pass a transaction running as the app role.

export interface Closure {
  id: string;
  /** Null when the whole organization is closed. */
  officeId: string | null;
  officeName: string | null;
  entry: RangeEntry;
}

/** An active office a closure can be recorded for. */
export interface OfficeOption {
  id: string;
  name: string;
}

type Refusal = "forbidden" | "invalidInput" | "notFound";

type Result<T> = ({ ok: true } & T) | { ok: false; reason: Refusal };

const forbidden = { ok: false, reason: "forbidden" } as const;
const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;

function isAdmin(actor: Actor): boolean {
  return actor.roles.includes("admin");
}

/** Every closure, latest first, the offices a new one can close, and whether the actor may. */
export async function listClosures(
  actor: Actor,
  database?: AnyDatabase,
): Promise<{ closures: Closure[]; offices: OfficeOption[]; canEdit: boolean }> {
  return withTenant(
    actor,
    async (tx) => {
      const rows = await tx
        .select({
          id: closure.id,
          officeId: closure.officeId,
          officeName: office.name,
          timeZone: office.timeZone,
          during: closure.during,
        })
        .from(closure)
        .leftJoin(office, eq(office.id, closure.officeId))
        .orderBy(sql`lower(${closure.during}) desc`);
      const offices = await tx
        .select({ id: office.id, name: office.name })
        .from(office)
        .where(eq(office.active, true))
        .orderBy(asc(office.name));
      return {
        closures: rows.map((row) => ({
          id: row.id,
          officeId: row.officeId,
          officeName: row.officeName,
          entry: toRangeEntry(row.during, row.timeZone ?? defaultTimeZone),
        })),
        offices,
        canEdit: isAdmin(actor),
      };
    },
    database,
  );
}

/** The zone a closure of `officeId` is read in, or `undefined` when the office is missing. */
async function zoneOf(tx: Transaction, officeId: string | null): Promise<string | undefined> {
  if (officeId === null) {
    return defaultTimeZone;
  }
  const [found] = await tx
    .select({ timeZone: office.timeZone })
    .from(office)
    .where(eq(office.id, officeId));
  return found?.timeZone;
}

export async function createClosure(
  actor: Actor,
  input: ClosureInput,
  database?: AnyDatabase,
): Promise<Result<{ closure: { id: string } }>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = closureInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { officeId, entry } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const timeZone = await zoneOf(tx, officeId);
      if (timeZone === undefined) {
        return notFound;
      }
      const [created] = await tx
        .insert(closure)
        .values({
          organizationId: actor.organizationId,
          officeId,
          during: toTimeRange(entry, timeZone),
        })
        .returning({ id: closure.id });
      return { ok: true as const, closure: created! };
    },
    database,
  );
}

export async function updateClosure(
  actor: Actor,
  input: ClosureUpdate,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = closureUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { closureId, officeId, entry } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      const timeZone = await zoneOf(tx, officeId);
      if (timeZone === undefined) {
        return notFound;
      }
      const updated = await tx
        .update(closure)
        .set({ officeId, during: toTimeRange(entry, timeZone) })
        .where(eq(closure.id, closureId))
        .returning({ id: closure.id });
      return updated.length === 0 ? notFound : { ok: true as const };
    },
    database,
  );
}

export async function deleteClosure(
  actor: Actor,
  input: ClosureDelete,
  database?: AnyDatabase,
): Promise<Result<object>> {
  if (!isAdmin(actor)) {
    return forbidden;
  }
  const parsed = closureDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  return withTenant(
    actor,
    async (tx) => {
      const deleted = await tx
        .delete(closure)
        .where(eq(closure.id, parsed.data.closureId))
        .returning({ id: closure.id });
      return deleted.length === 0 ? notFound : { ok: true as const };
    },
    database,
  );
}
