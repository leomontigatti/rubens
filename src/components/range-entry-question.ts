import type { AffectsAppointments, Notice } from "#/lib/time-ranges.ts";

// The question a time-off or closure save asks when the server refuses it for
// the appointments it sends to the "to reschedule" list: whether to tell their
// patients by WhatsApp. The answer saves the same values again with the count
// it was asked about, so a count that changed meanwhile asks again.

type Outcome<R extends string> = { ok: true } | { ok: false; reason: R };

/** The values a save was asked about, and how many appointments it sends to the list. */
export interface NoticeQuestion<V> {
  values: V;
  affected: number;
}

/** How the question names what is saved. */
const subjects = { timeOff: "Esta licencia", closure: "Este cierre" };

export type QuestionSubject = keyof typeof subjects;

/** The question `result` asks of the save of `values`; `null` when it asks none. */
export function questionAfter<V, R extends string>(
  values: V,
  result: Outcome<R> | AffectsAppointments,
): NoticeQuestion<V> | null {
  if (result.ok || result.reason !== "affectsAppointments") {
    return null;
  }
  return { values, affected: (result as AffectsAppointments).affected };
}

/** The save that answers `question`, telling the patients or not. */
export function answering<V>(
  question: NoticeQuestion<V>,
  tellPatients: boolean,
): { values: V; notice: Notice } {
  return { values: question.values, notice: { tellPatients, affected: question.affected } };
}

export function questionText(subject: QuestionSubject, affected: number): string {
  const appointments = affected === 1 ? "1 turno" : `${affected} turnos`;
  return `${subjects[subject]} deja ${appointments} fuera de horario. Pasan a Turnos a reprogramar, se avise o no.`;
}
