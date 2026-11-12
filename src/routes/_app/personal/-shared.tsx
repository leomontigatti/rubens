import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";
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
  lastClinicalContact:
    "Es el último contacto de derivación que lleva historias clínicas. Antes, elegí otro en la configuración de WhatsApp.",
  emailTaken: "Ya hay una cuenta con ese correo.",
  passwordTooShort:
    "La contraseña inicial debe tener entre 8 y 72 caracteres (una letra con tilde ocupa dos y un emoji, cuatro).",
  passwordTooLong:
    "La contraseña inicial debe tener entre 8 y 72 caracteres (una letra con tilde ocupa dos y un emoji, cuatro).",
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

/**
 * For the edit form, whose refusals show under the field that caused them: the
 * last admin's under the roles, the last clinical contact's under the roles or,
 * as `lastClinicalContactSetting`, under the setting.
 */
export function useEditAction() {
  return useFormAction(
    { ...refusalMessages, lastClinicalContactSetting: refusalMessages.lastClinicalContact },
    {
      lastAdmin: "roles",
      lastClinicalContact: "roles",
      lastClinicalContactSetting: "keepsClinicalRecords",
    },
  );
}

export function RefusalAlert({ reason }: { reason: RefusalReason }) {
  return <RefusalMessage message={refusalMessages[reason]} />;
}

/** The roles a form's `CheckboxGroupField` offers. */
export const roleOptions = Object.entries(roleLabels).map(([value, label]) => ({ value, label }));
