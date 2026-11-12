// The fixed choices of the fields that take a few lengths of time: a medical
// service's duration and reschedule cutoff, and the WhatsApp settings' hours.
// A value stored before the field became a select, or saved another way, stays
// as one more choice in its place, so opening the form never changes it.

interface HourChoice {
  value: string;
  label: string;
}

/** `steps` with `stored` among them, in order, each labelled. */
function choicesWith(
  steps: number[],
  stored: number,
  label: (amount: number) => string,
): HourChoice[] {
  const amounts = steps.includes(stored) ? steps : [...steps, stored].sort((a, b) => a - b);
  return amounts.map((amount) => ({ value: String(amount), label: label(amount) }));
}

const range = (from: number, to: number, step: number) =>
  Array.from({ length: (to - from) / step + 1 }, (_, index) => from + index * step);

/** `75` as `1 h 15 min`. */
function minutesLabel(minutes: number) {
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
  if (hours === 0) {
    return `${rest} min`;
  }
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** `30` hours before the appointment as `1 día y 6 h antes`. */
function cutoffLabel(hours: number) {
  if (hours === 0) {
    return "Hasta el turno";
  }
  const [days, rest] = [Math.floor(hours / 24), hours % 24];
  const daysText = days === 1 ? "1 día" : `${days} días`;
  if (days === 0) {
    return `${rest} h antes`;
  }
  return rest === 0 ? `${daysText} antes` : `${daysText} y ${rest} h antes`;
}

const hoursLabel = (hours: number) => `${hours} h`;

/** A medical service's duration: 15 minutes to 3 hours, in steps of 15. */
export const durationChoices = (stored: number) =>
  choicesWith(range(15, 180, 15), stored, minutesLabel);

/** Until how long before the appointment it can be moved: up to 2 days, in steps of 6 hours. */
export const cutoffChoices = (stored: number) => choicesWith(range(0, 48, 6), stored, cutoffLabel);

/** How long a conversation taken over stays with its member. */
export const returnTimeChoices = (stored: number) =>
  choicesWith([1, 2, 4, 8, 12, 24], stored, hoursLabel);

/** How long before the conversation window closes a handoff is reminded. */
export const handoffReminderChoices = (stored: number) =>
  choicesWith([1, 2, 3, 4, 6, 8, 12], stored, hoursLabel);
