import { createFileRoute } from "@tanstack/react-router";

import { useAppForm } from "#/components/app-form.tsx";
import { fixedCrumbs } from "#/components/app-breadcrumbs.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { officeInputSchema } from "#/lib/offices.ts";
import type { OfficeInput } from "#/lib/offices.ts";
import { editOffice, getOfficeWithRooms } from "#/server/offices.functions.ts";
import type { Office } from "#/organization/offices.ts";

import { RefusedPage, useAction } from "#/routes/_app/consultorios/-shared.tsx";

// The office's own form page, reached from `Consultorios`' `Acciones` menu:
// the office has no page titled by its name (LEO-6's prototype pass, variant C).

export const Route = createFileRoute("/_app/consultorios/sede")({
  loader: () => getOfficeWithRooms({ data: { includeInactive: false } }),
  head: () => ({ meta: [{ title: "Datos de la sede · underthing" }] }),
  staticData: { crumbs: fixedCrumbs("Datos de la sede") },
  component: OfficePage,
});

function OfficePage() {
  const { viewer } = Route.useRouteContext();
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusedPage title="Datos de la sede" reason={result.reason} />;
  }
  if (!viewer.roles.includes("admin")) {
    return <RefusedPage title="Datos de la sede" reason="forbidden" />;
  }
  return <OfficeForm office={result.office} />;
}

const fieldMessages: Record<keyof OfficeInput, string> = {
  name: "Ingresá el nombre de la sede.",
  address: "Ingresá el domicilio de la sede.",
};

function OfficeForm({ office }: { office: Office }) {
  const page = useFormPage({ to: "/consultorios" });
  const action = useAction();
  const form = useAppForm({
    defaultValues: { name: office.name, address: office.address },
    onSubmit: async ({ value }) => {
      const input = officeInputSchema.safeParse(value);
      if (!input.success) {
        page.showProblems(fieldProblems(input.error.issues, messageIn(fieldMessages)));
        return;
      }
      if (await action.save(() => editOffice({ data: { ...input.data, officeId: office.id } }))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title="Datos de la sede"
      description="El nombre y el domicilio de la sede."
      submitLabel="Guardar"
      action={action}
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Nombre" size="half" required />}
      </form.AppField>
      <form.AppField name="address">
        {(field) => (
          <field.TextField
            label="Domicilio"
            size="half"
            placeholder="Av. Colón 1234, Córdoba"
            required
          />
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
