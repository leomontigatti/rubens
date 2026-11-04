import { patientSearchMore } from "#/components/patient-search.ts";

/** Under a patient search's results, when more patients match than it shows. */
export function MorePatientMatches(props: { search: Parameters<typeof patientSearchMore>[0] }) {
  const more = patientSearchMore(props.search);
  return more && <p className="text-muted-foreground text-sm">{more}</p>;
}
