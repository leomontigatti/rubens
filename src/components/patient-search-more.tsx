/**
 * Under a patient search that stopped at its best matches while others match
 * too: how many are shown, and that typing more narrows the rest. Nothing for
 * an answer with no more, a refusal, or no answer yet.
 */
export function MorePatientMatches(props: {
  found?: { patients: readonly unknown[]; more: boolean } | { ok: false };
}) {
  const { found } = props;
  if (!found || !("more" in found) || !found.more) {
    return null;
  }
  return (
    <p className="text-muted-foreground text-sm">
      Se muestran las {found.patients.length} mejores coincidencias. Escribí más para acotar la
      búsqueda.
    </p>
  );
}
