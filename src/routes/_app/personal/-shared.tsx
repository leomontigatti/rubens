import { cn } from "cn";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "#/components/ui/field.tsx";
import type { Role } from "#/lib/access.ts";
import { practitionerColorClasses } from "#/lib/practitioner-colors.ts";
import type { PractitionerColor } from "#/lib/practitioner-colors.ts";
import { roleLabels } from "#/lib/staff.ts";

// The pieces the staff screens share: refusal copy and the role checkboxes.

/** The copy for every refusal the staff server functions return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede ver y cambiar el personal.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos a esa persona.",
  lastAdmin: "Tiene que quedar al menos un administrador activo.",
  emailTaken: "Ya hay una cuenta con ese correo.",
  passwordTooShort: "La contraseña inicial debe tener entre 8 y 128 caracteres.",
  passwordTooLong: "La contraseña inicial debe tener entre 8 y 128 caracteres.",
};

export type RefusalReason = keyof typeof refusalMessages;

export function useAction() {
  return useFormAction(refusalMessages);
}

export function RefusalAlert({ reason }: { reason: RefusalReason }) {
  return <RefusalMessage message={refusalMessages[reason]} />;
}

export function ColorSwatch({ color }: { color: PractitionerColor }) {
  return (
    <span
      aria-hidden
      className={cn("size-4 shrink-0 rounded-full", practitionerColorClasses[color])}
    />
  );
}

/** The roles a form submitted through `RoleCheckboxes`. */
export function formRoles(form: FormData): string[] {
  return form.getAll("roles").map(String);
}

export function RoleCheckboxes(props: { idPrefix: string; initial: readonly Role[] }) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Roles</FieldLegend>
      <FieldGroup data-slot="checkbox-group">
        {Object.entries(roleLabels).map(([role, label]) => (
          <Field key={role} orientation="horizontal" className="w-fit">
            {/* Keyed on the saved value: Base UI warns when an uncontrolled
                checkbox's default changes, as it does after a save reloads. */}
            <Checkbox
              key={String(props.initial.includes(role as Role))}
              id={`${props.idPrefix}-role-${role}`}
              name="roles"
              value={role}
              defaultChecked={props.initial.includes(role as Role)}
            />
            <FieldLabel htmlFor={`${props.idPrefix}-role-${role}`}>{label}</FieldLabel>
          </Field>
        ))}
      </FieldGroup>
    </FieldSet>
  );
}
