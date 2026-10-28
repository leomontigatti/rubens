import { eq } from "drizzle-orm";

import { appointment } from "#/db/schema/index.ts";
import { withTenant } from "#/db/tenant.ts";
import type { AnyDatabase } from "#/db/tenant.ts";
import type { Actor } from "#/lib/access.ts";
import { receptionNoteChangeSchema } from "#/lib/appointments.ts";
import type { ReceptionNoteChange } from "#/lib/appointments.ts";

import { booksForSome, findBookablePractitioner, lockAppointment } from "#/server/appointments.ts";
import { changedFields, recordAudit } from "#/server/audit.ts";

// Editing an appointment's reception note, as booking writes it: whoever may
// book for the practitioner, audited about the patient. `database` is for
// tests, which pass a transaction running as the app role.

export type ReceptionNoteResult =
  | { ok: true }
  | {
      ok: false;
      reason: "forbidden" | "invalidInput" | "notFound" | "practitionerInactive";
    };

export async function editReceptionNote(
  actor: Actor,
  input: ReceptionNoteChange,
  database?: AnyDatabase,
): Promise<ReceptionNoteResult> {
  if (!booksForSome(actor)) {
    return { ok: false, reason: "forbidden" };
  }
  const parsed = receptionNoteChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" };
  }
  const { appointmentId, receptionNote } = parsed.data;
  return withTenant(
    actor,
    async (tx) => {
      await lockAppointment(tx, appointmentId);
      const [current] = await tx
        .select({
          practitionerId: appointment.practitionerId,
          patientId: appointment.patientId,
          receptionNote: appointment.receptionNote,
        })
        .from(appointment)
        .where(eq(appointment.id, appointmentId));
      if (!current) {
        return { ok: false as const, reason: "notFound" as const };
      }
      const found = await findBookablePractitioner(tx, actor, current.practitionerId);
      if (!found.ok) {
        return found;
      }
      const changed = changedFields({ receptionNote: current.receptionNote }, { receptionNote });
      if (changed) {
        await tx
          .update(appointment)
          .set({ receptionNote, updatedAt: new Date() })
          .where(eq(appointment.id, appointmentId));
        await recordAudit(tx, actor, {
          action: "update",
          entityType: "appointment",
          entityId: appointmentId,
          patientId: current.patientId,
          ...changed,
        });
      }
      return { ok: true as const };
    },
    database,
  );
}
