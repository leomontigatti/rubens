import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { useAppForm } from "#/components/app-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { getMember, resetStartingPassword } from "#/server/staff.functions.ts";
import type { StaffMember } from "#/server/staff.ts";

import { RefusalAlert, useAction } from "#/routes/_app/personal/-shared.tsx";

export const Route = createFileRoute("/_app/personal/$memberId_/contrasena")({
  loader: ({ params }) => getMember({ data: { memberId: params.memberId } }),
  head: () => ({ meta: [{ title: "Asignar contraseña inicial · Rubens" }] }),
  component: AssignPassword,
});

function AssignPassword() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  return <StartingPasswordForm member={result.member} />;
}

/** It stays on the page once saved: nothing else would show that it worked. */
function StartingPasswordForm({ member }: { member: StaffMember }) {
  const { memberId } = member;
  const page = useFormPage({ to: "/personal/$memberId", params: { memberId } });
  const action = useAction();
  const [done, setDone] = useState(false);

  const form = useAppForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value, formApi }) => {
      setDone(false);
      const { password } = value;
      if (await action.run(() => resetStartingPassword({ data: { memberId, password } }))) {
        formApi.reset();
        setDone(true);
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title="Asignar contraseña inicial"
      description={member.name}
      submitLabel="Asignar"
      action={action}
    >
      {done && (
        <Alert variant="success">
          <AlertTitle>Listo</AlertTitle>
          <AlertDescription>
            La persona tiene que cambiarla la próxima vez que ingrese.
          </AlertDescription>
        </Alert>
      )}
      <form.AppField name="password">
        {(field) => (
          <field.TextField
            label="Contraseña inicial nueva"
            autoComplete="off"
            required
            hint="Reemplaza la contraseña actual. La persona la usa para ingresar y la cambia al entrar."
          />
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
