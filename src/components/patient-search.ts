// The patient list's search, as cached by the query client. The cache outlives
// a sign-out, so each entry names who asked and for which organization.

/** Every patient search: what a patient save invalidates. */
export const patientSearchQueries = ["patients", "search"] as const;

export function patientSearchKey(
  viewer: { organizationId: string; userId: string },
  search: { query: string; includeInactive: boolean },
) {
  return [...patientSearchQueries, viewer.organizationId, viewer.userId, search] as const;
}

export interface PatientSearchState<Found> {
  searching: boolean;
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
    return { searching: false, failed: false };
  }
  if (typed.trim() !== asked.trim()) {
    return { searching: true, failed: false };
  }
  return answer.isError
    ? { searching: true, failed: true }
    : { searching: true, found: answer.data, failed: false };
}
