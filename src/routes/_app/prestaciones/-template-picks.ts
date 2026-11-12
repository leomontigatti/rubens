// The templates a medical service picks in its form's "Mensajes por WhatsApp":
// which ones it is offered, and the cap on its reminders, which the object
// checks again.

import { maxReminders } from "#/lib/medical-services.ts";
import type { Timing } from "#/lib/template-timing.ts";
import { timingLabel } from "#/lib/whatsapp-template-copy.ts";

/** One of the organization's templates a medical service can pick. */
export interface PickableTemplate {
  id: string;
  name: string;
  timing: Timing;
  /** Whether Meta approved a version that goes now. */
  approved: boolean;
}

/**
 * The approved templates, and any other the medical service already picks, so
 * an edit shows and keeps it until it is removed.
 */
export function templateOptions(templates: PickableTemplate[], picked: readonly string[]) {
  return templates
    .filter((one) => one.approved || picked.includes(one.id))
    .map((one) => ({ value: one.id, label: one.name, detail: timingLabel(one.timing) }));
}

/** Whether `picked` holds more reminders, templates timed before the appointment, than one sends. */
export function tooManyReminders(templates: PickableTemplate[], picked: readonly string[]) {
  const reminders = templates.filter(
    (one) => one.timing.when === "before" && picked.includes(one.id),
  );
  return reminders.length > maxReminders;
}
