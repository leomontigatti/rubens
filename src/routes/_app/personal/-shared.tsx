import { cn } from "cn";

import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
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
  passwordTooShort:
    "La contraseña inicial debe tener entre 8 y 72 caracteres (las letras con tilde y los símbolos cuentan doble).",
  passwordTooLong:
    "La contraseña inicial debe tener entre 8 y 72 caracteres (las letras con tilde y los símbolos cuentan doble).",
  passwordRejected: "Esa contraseña es demasiado común o débil. Elegí otra.",
};

export type RefusalReason = keyof typeof refusalMessages;

export function useAction() {
  return useFormAction(refusalMessages, {
    emailTaken: "email",
    passwordTooShort: "password",
    passwordTooLong: "password",
    passwordRejected: "password",
  });
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

/** The roles a form's `CheckboxGroupField` offers. */
export const roleOptions = Object.entries(roleLabels).map(([value, label]) => ({ value, label }));
