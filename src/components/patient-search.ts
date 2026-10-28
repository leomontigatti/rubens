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
