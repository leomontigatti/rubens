import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
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

/** The office field: empty for the whole organization. */
export function readOfficeId(form: FormData): string | null {
  const officeId = form.get("officeId") as string;
  return officeId === "" ? null : officeId;
}

export function OfficeSelect(props: { offices: OfficeOption[]; initial: string | null }) {
  return (
    <Field>
      <FieldLabel htmlFor="closure-officeId">Sede</FieldLabel>
      <NativeSelect id="closure-officeId" name="officeId" defaultValue={props.initial ?? ""}>
        <NativeSelectOption value="">{wholeOrganization}</NativeSelectOption>
        {props.offices.map((office) => (
          <NativeSelectOption key={office.id} value={office.id}>
            {office.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
