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

/**
 * Whether a previous search's results may stand in while this one is asked:
 * only as the same text being typed on, and never across the inactive filter.
 */
export function continuesPatientSearch(
  previousKey: ReturnType<typeof patientSearchKey> | undefined,
  search: { query: string; includeInactive: boolean },
) {
  const previous = previousKey?.[4];
  if (previous?.includeInactive !== search.includeInactive) {
    return false;
  }
  return previous.query.startsWith(search.query) || search.query.startsWith(previous.query);
}
