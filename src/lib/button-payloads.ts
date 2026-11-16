import * as z from "zod";

// The payloads underthing sets on a template's quick-reply buttons when it sends
// one (ADR-0014). Meta sends the payload back with a tap, so code reads which
// button was tapped, and for which appointment at which start, without reading
// the patient's words. Anything else reads as no payload of underthing's, and
// the tap goes to the model as the patient's words.

export type ButtonPayload =
  | { kind: "confirm"; appointmentId: string; startsAt: number }
  | { kind: "reopen" };

/** `Sí, voy`'s payload, for the appointment at the start the message stated. */
export function confirmPayload(appointmentId: string, startsAt: number) {
  return `confirm:${appointmentId}:${startsAt}`;
}

/** `Ver respuesta`'s payload. */
export function reopenPayload() {
  return "reopen";
}

const confirmParts = z.tuple([
  z.literal("confirm"),
  z.uuid(),
  z.string().regex(/^\d+$/).transform(Number),
]);

/**
 * A tap code did not act on, as the model reads it: the button's label, with
 * the words of the message it answers, or without them when it cannot quote them.
 */
export function tapLine(label: string, target: string | null) {
  return target === null
    ? `[tocó el botón «${label}» de un mensaje]`
    : `[tocó el botón «${label}» del mensaje: «${target}»]`;
}

/** The button `payload` names, or `null` for one underthing did not set. */
export function readButtonPayload(payload: string): ButtonPayload | null {
  if (payload === reopenPayload()) {
    return { kind: "reopen" };
  }
  const confirm = confirmParts.safeParse(payload.split(":"));
  if (!confirm.success) {
    return null;
  }
  const [, appointmentId, startsAt] = confirm.data;
  return { kind: "confirm", appointmentId, startsAt };
}
