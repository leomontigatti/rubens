import { ErrorAlert, useFormAction } from "#/components/admin-form.tsx";
import { PageHeader } from "#/components/page-header.tsx";

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

/** A refused page: its title, and the refusal under it. */
export function RefusedPage(props: { title: string; reason: RefusalReason }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={props.title} />
      <ErrorAlert message={refusalMessages[props.reason]} />
    </div>
  );
}
