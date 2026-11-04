import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";

import {
  patientSearchKey,
  patientSearchRequest,
  patientSearchState,
} from "#/components/patient-search.ts";
import type { PatientSearchState } from "#/components/patient-search.ts";
import { useDebounced } from "#/components/use-debounced.ts";
import { findPatients } from "#/server/patients.functions.ts";

const searchDelay = 300;

export type PatientSearch = PatientSearchState<Awaited<ReturnType<typeof findPatients>>>;

/**
 * The patients matching what is typed, asked for once typing pauses. Each query
 * is its own request, and only the answer to the text in the box is shown.
 */
export function usePatientSearch(typed: string, includeInactive = false): PatientSearch {
  const { viewer } = useRouteContext({ from: "/_app" });
  const asked = useDebounced(typed, searchDelay);
  const search = patientSearchRequest(asked, includeInactive);
  const answer = useQuery({
    queryKey: patientSearchKey(viewer, search),
    queryFn: () => findPatients({ data: search }),
    enabled: search.query !== "",
  });
  return patientSearchState(typed, asked, answer);
}
