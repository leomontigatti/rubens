import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import type { OfficeOption } from "#/server/closures.ts";

/** The copy for every refusal the closure server functions return. */
export const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar cierres.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos esa sede o ese cierre.",
};

export const wholeOrganization = "Toda la organización";

/** The office the form holds: empty for the whole organization. */
export const readOfficeId = (owner: string): string | null => (owner === "" ? null : owner);

/** The office field of a closure's form. */
export function officeField(offices: OfficeOption[], initial: string | null) {
  return {
    label: "Sede",
    initial: initial ?? "",
    options: (
      <>
        <NativeSelectOption value="">{wholeOrganization}</NativeSelectOption>
        {offices.map((office) => (
          <NativeSelectOption key={office.id} value={office.id}>
            {office.name}
          </NativeSelectOption>
        ))}
      </>
    ),
  };
}
