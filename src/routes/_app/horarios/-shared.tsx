import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { appointmentCollisionLabel, collisionLabel } from "#/lib/schedules.ts";
import type { AppointmentCollision, Collision } from "#/organization/schedules.ts";

// The refusal copy the schedule screens share, collisions included.

/** The copy for every refusal the schedule server functions return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador o el propio profesional pueden cambiar sus horarios.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese profesional, ese horario o ese consultorio.",
  practitionerInactive: "El profesional está archivado: no se le pueden cargar horarios.",
  roomInactive: "El consultorio está archivado. Elegí otro o restauralo.",
  dateInPast: "La fecha ya pasó. Elegí hoy o una fecha posterior.",
  alreadyStarted: "El horario ya empezó, así que no se puede eliminar. Terminalo en una fecha.",
  roomFull: "El consultorio ya está completo en ese horario.",
  practitionerBusy: "El profesional ya tiene otro horario a esa hora.",
};

export type RefusalReason = keyof typeof refusalMessages;

export type ActionResult =
  | { ok: true }
  | { ok: false; reason: RefusalReason }
  | { ok: false; reason: "roomFull" | "practitionerBusy"; collision: Collision }
  | { ok: false; reason: "roomFull"; appointment: AppointmentCollision };

/** A collision told as the schedule or appointment it meets; `null` for any other result. */
function collisionMessage(result: ActionResult): string | null {
  if (result.ok) {
    return null;
  }
  if ("collision" in result) {
    return `${refusalMessages[result.reason]} ${collisionLabel(result.collision)}`;
  }
  return "appointment" in result
    ? `${refusalMessages.roomFull} ${appointmentCollisionLabel(result.appointment)}`
    : null;
}

/** The shared submit step, with a collision told as what it meets. */
export function useAction() {
  const action = useFormAction(refusalMessages);

  async function tellingCollisions(
    submit: typeof action.run,
    work: () => Promise<ActionResult>,
  ): Promise<boolean> {
    let collision: string | null = null;
    const ok = await submit(async () => {
      const result = await work();
      collision = collisionMessage(result);
      return result;
    });
    if (collision) {
      action.setError(collision);
    }
    return ok;
  }

  return {
    ...action,
    run: (work: () => Promise<ActionResult>) => tellingCollisions(action.run, work),
    save: (work: () => Promise<ActionResult>) => tellingCollisions(action.save, work),
  };
}

export function RefusalAlert({ reason }: { reason: RefusalReason }) {
  return <RefusalMessage message={refusalMessages[reason]} />;
}
