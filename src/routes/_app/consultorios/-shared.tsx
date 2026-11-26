import { RefusalMessage, useFormAction } from "#/components/admin-form.tsx";

// The refusal copy the `Consultorios` page, its room dialog and the office form share.

/** The copy for every refusal the office and room server functions return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar la sede y los consultorios.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos esa sede o ese consultorio.",
};

export type RefusalReason = keyof typeof refusalMessages;

export function useAction() {
  return useFormAction(refusalMessages);
}

export function RefusalAlert({ reason }: { reason: RefusalReason }) {
  return <RefusalMessage message={refusalMessages[reason]} />;
}
