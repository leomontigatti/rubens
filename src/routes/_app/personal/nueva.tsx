import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";

import { fieldMessage } from "#/components/admin-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { staffInputSchema } from "#/lib/staff.ts";
import type { StaffInput } from "#/lib/staff.ts";
import { addStaffMember, getStaff } from "#/server/staff.functions.ts";

import {
  RefusalAlert,
  RoleCheckboxes,
  formRoles,
  useAction,
} from "#/routes/_app/personal/-shared.tsx";

export const Route = createFileRoute("/_app/personal/nueva")({
  head: () => ({ meta: [{ title: "Nueva persona · Rubens" }] }),
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = staffInputSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
      roles: formRoles(form),
    });
    if (!input.success) {
      action.setError(fieldMessage(fieldMessages, input.error));
      return;
    }
    if (await action.run(() => addStaffMember({ data: input.data }))) {
      page.leave();
    }
  }

  return (
    <ActionFormPage
      page={page}
      title="Nueva persona"
      submitLabel="Crear cuenta"
      action={action}
      onSubmit={handleSubmit}
    >
      <Field>
        <FieldLabel htmlFor="new-name">Nombre</FieldLabel>
        <Input id="new-name" name="name" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="new-email">Correo</FieldLabel>
        <Input id="new-email" name="email" type="email" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="new-password">Contraseña inicial</FieldLabel>
        <Input
          id="new-password"
          name="password"
          type="text"
          autoComplete="off"
          required
          aria-describedby="new-password-hint"
        />
        <FieldDescription id="new-password-hint">
          La persona la usa para ingresar la primera vez y la cambia al entrar.
        </FieldDescription>
      </Field>
      <RoleCheckboxes idPrefix="new" initial={[]} />
    </ActionFormPage>
  );
}
