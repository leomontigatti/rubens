import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";

// The refusal copy the office and room screens share.

/** The copy for every refusal the office and room server functions return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar sedes y consultorios.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos esa sede o ese consultorio.",
  officeInactive: "La sede está desactivada. Reactivala para agregarle consultorios.",
};

export type RefusalReason = keyof typeof refusalMessages;

export type ActionResult = { ok: true } | { ok: false; reason: RefusalReason };

export function useAction() {
  return useFormAction(refusalMessages);
}

export function RefusalAlert({ reason }: { reason: RefusalReason }) {
  return <RefusalMessage message={refusalMessages[reason]} />;
}
