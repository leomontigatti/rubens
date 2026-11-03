import { patientRefusalMessages } from "#/components/patient-save.ts";

// The patient search, as the patient list and the booking's patient picker run
// it (`usePatientSearch`). The query client's cache outlives a sign-out, so each
// entry names who asked and for which organization.

/** Every patient search: what a patient save invalidates. */
export const patientSearchQueries = ["patients", "search"] as const;

export function patientSearchKey(
  viewer: { organizationId: string; userId: string },
  search: { query: string; includeInactive: boolean },
) {
  return [...patientSearchQueries, viewer.organizationId, viewer.userId, search] as const;
}

/** What the search asks the server for the text typing settled on. */
export function patientSearchRequest(asked: string, includeInactive: boolean) {
  return { query: asked.trim(), includeInactive };
}

export interface PatientSearchState<Found> {
  searching: boolean;
  /** Searching, with neither an answer nor a failure for the text in the box yet. */
  waiting: boolean;
  /** The answer to the text in the box: nothing else may stand in for it. */
  found?: Found;
  failed: boolean;
}

/** Where a search stands, from the text typed and the text the answer is for. */
export function patientSearchState<Found>(
  typed: string,
  asked: string,
  answer: { data?: Found; isError: boolean },
): PatientSearchState<Found> {
  if (typed.trim() === "") {
    return { searching: false, waiting: false, failed: false };
  }
  if (typed.trim() !== asked.trim()) {
    return { searching: true, waiting: true, failed: false };
  }
  return answer.isError
    ? { searching: true, waiting: false, failed: true }
    : { searching: true, waiting: answer.data === undefined, found: answer.data, failed: false };
}

type PatientRefusal = keyof typeof patientRefusalMessages;

/** The patients the answer to the text in the box found; nothing until there is one. */
export function patientSearchMatches<Match>(
  search: PatientSearchState<
    { ok: true; patients: Match[] } | { ok: false; reason: PatientRefusal }
  >,
): Match[] | undefined {
  return search.found?.ok ? search.found.patients : undefined;
}

/** What to say instead of the results: a refusal, a failure, or nothing. */
export function patientSearchProblem(
  search: PatientSearchState<{ ok: true } | { ok: false; reason: PatientRefusal }>,
) {
  if (search.found && !search.found.ok) {
    return patientRefusalMessages[search.found.reason];
  }
  return search.failed ? "No pudimos buscar. Probá de nuevo." : null;
}
