import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { collisionLabel } from "#/lib/schedules.ts";
import type { Collision } from "#/server/schedules.ts";

// The refusal copy the schedule screens share, collisions included.

/** The copy for every refusal the schedule server functions return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador o el propio profesional pueden cambiar sus horarios.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese profesional, ese horario o ese consultorio.",
  practitionerInactive: "El profesional está desactivado: no se le pueden cargar horarios.",
  roomInactive: "El consultorio está desactivado. Elegí otro o reactivalo.",
  officeInactive: "La sede del consultorio está desactivada. Elegí otro consultorio.",
  dateInPast: "La fecha ya pasó. Elegí hoy o una fecha posterior.",
  alreadyStarted: "El horario ya empezó, así que no se puede eliminar. Terminalo en una fecha.",
  roomFull: "El consultorio ya está completo en ese horario.",
  practitionerBusy: "El profesional ya tiene otro horario a esa hora.",
  otherTimeZone:
    "El profesional ya tiene horarios en esas fechas en una sede con otra zona horaria.",
};

export type RefusalReason = keyof typeof refusalMessages;

export type ActionResult =
  | { ok: true }
  | { ok: false; reason: RefusalReason }
  | { ok: false; reason: "roomFull" | "practitionerBusy"; collision: Collision };

/** The shared submit step, with a collision told as the schedule it meets. */
export function useAction() {
  const action = useFormAction(refusalMessages);

  async function run(work: () => Promise<ActionResult>): Promise<boolean> {
    let collision: string | null = null;
    const ok = await action.run(async () => {
      const result = await work();
      if (!result.ok && "collision" in result) {
        collision = `${refusalMessages[result.reason]} ${collisionLabel(result.collision)}`;
      }
      return result;
    });
    if (collision) {
      action.setError(collision);
    }
    return ok;
  }

  return { ...action, run };
}

export function RefusalAlert({ reason }: { reason: RefusalReason }) {
  return <RefusalMessage message={refusalMessages[reason]} />;
}
