import { createFileRoute } from "@tanstack/react-router";

import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { staffInputSchema } from "#/lib/staff.ts";
import type { StaffInput } from "#/lib/staff.ts";
import { addStaffMember, getStaff } from "#/server/staff.functions.ts";

import { RefusalAlert, roleOptions, useAction } from "#/routes/_app/personal/-shared.tsx";

export const Route = createFileRoute("/_app/personal/nueva")({
  head: () => ({ meta: [{ title: "Nueva persona · underthing" }] }),
  loader: () => getStaff(),
  component: NewStaffMember,
});

const fieldMessages: Record<keyof StaffInput, string> = {
  name: "Ingresá el nombre.",
  email: "Ingresá un correo válido.",
  password: "Ingresá una contraseña inicial.",
  roles: "Elegí al menos un rol.",
};

function NewStaffMember() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  return <StaffForm />;
}

function StaffForm() {
  const page = useFormPage({ to: "/personal" });
  const action = useAction();
  const form = useAppForm({
    defaultValues: { name: "", email: "", password: "", roles: [] as string[] },
    onSubmit: async ({ value }) => {
      const input = staffInputSchema.safeParse(value);
      if (!input.success) {
        page.showProblems(fieldProblems(input.error.issues, messageIn(fieldMessages)));
        return;
      }
      if (await action.save(() => addStaffMember({ data: input.data }))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title="Nueva persona"
      submitLabel="Crear cuenta"
      creates
      action={action}
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Nombre" required />}
      </form.AppField>
      <form.AppField name="email">
        {(field) => <field.TextField label="Correo" type="email" required />}
      </form.AppField>
      <form.AppField name="password">
        {(field) => (
          <field.TextField
            label="Contraseña inicial"
            autoComplete="off"
            startsRow
            required
            hint="La persona la usa para ingresar la primera vez y la cambia al entrar."
          />
        )}
      </form.AppField>
      <form.AppField name="roles">
        {(field) => <field.CheckboxGroupField legend="Roles" options={roleOptions} />}
      </form.AppField>
    </ActionFormPage>
  );
}
