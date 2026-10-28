import type { DuplicateCandidate, DuplicateRefusal, Patient } from "#/server/patients.ts";

// The submit step of the patient registration and edit forms, as state and
// transitions: `usePatientSave` in patient-form.tsx dispatches them.

/** The copy for every refusal the patient server functions return. */
export const patientRefusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede desactivar pacientes y ver su historial de cambios.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese paciente.",
};

type PatientRefusal = keyof typeof patientRefusalMessages;

/** What registering or editing a patient answers. */
export type SaveResult =
  | { ok: true; patient: Patient }
  | { ok: false; reason: PatientRefusal }
  | DuplicateRefusal;

/** What the form shows after a save was refused: one of the three at most. */
export interface RefusalState {
  error: string | null;
  holder: Patient | null;
  candidates: DuplicateCandidate[];
}

/**
 * The form's save state. `input` is the last one sent, kept so a duplicate
 * warning's confirmation sends it again.
 */
export interface SaveState<I> extends RefusalState {
  pending: boolean;
  input: I | null;
}

export type SaveEvent<I> =
  | { type: "sent"; input: I }
  /** The server answered, or the call threw. */
  | { type: "settled" }
  | { type: "refused"; result: Exclude<SaveResult, { ok: true }> }
  | { type: "invalid"; message: string }
  | { type: "dismissed" };

const noRefusal: RefusalState = { error: null, holder: null, candidates: [] };

export function initialSaveState<I>(): SaveState<I> {
  return { ...noRefusal, pending: false, input: null };
}

function refusalState(result: Exclude<SaveResult, { ok: true }>): RefusalState {
  if (result.reason === "documentTaken") {
    return { ...noRefusal, holder: result.patient };
  }
  if (result.reason === "possibleDuplicates") {
    return { ...noRefusal, candidates: result.candidates };
  }
  return { ...noRefusal, error: patientRefusalMessages[result.reason] };
}

export function saveReducer<I>(state: SaveState<I>, event: SaveEvent<I>): SaveState<I> {
  switch (event.type) {
    case "sent":
      return { ...state, ...noRefusal, pending: true, input: event.input };
    case "settled":
      return { ...state, pending: false };
    case "refused":
      return { ...state, ...refusalState(event.result) };
    case "invalid":
      return { ...state, ...noRefusal, error: event.message };
    case "dismissed":
      return { ...state, ...noRefusal };
  }
}
