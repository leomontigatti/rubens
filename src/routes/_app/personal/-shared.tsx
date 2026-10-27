import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Label } from "#/components/ui/label.tsx";
import type { Role } from "#/lib/access.ts";

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

const roleLabels: Record<Role, string> = {
  admin: "Administrador",
  receptionist: "Recepcionista",
  practitioner: "Profesional",
};

export function rolesLabel(roles: readonly Role[]): string {
  return roles.map((role) => roleLabels[role]).join(", ");
}

/** The roles a form submitted through `RoleCheckboxes`. */
export function formRoles(form: FormData): string[] {
  return form.getAll("roles").map(String);
}

export function RoleCheckboxes(props: { idPrefix: string; initial: readonly Role[] }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Roles</legend>
      {Object.entries(roleLabels).map(([role, label]) => (
        <div key={role} className="flex items-center gap-2">
          <Checkbox
            id={`${props.idPrefix}-role-${role}`}
            name="roles"
            value={role}
            defaultChecked={props.initial.includes(role as Role)}
          />
          <Label htmlFor={`${props.idPrefix}-role-${role}`}>{label}</Label>
        </div>
      ))}
    </fieldset>
  );
}
