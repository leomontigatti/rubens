import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Field, FieldDescription, FieldLabel } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password") as string;
    setDone(false);
    if (await action.save(() => resetStartingPassword({ data: { memberId, password } }))) {
      page.reset();
      setDone(true);
    }
  }

  return (
    <ActionFormPage
      page={page}
      title="Asignar contraseña inicial"
      description={member.name}
      submitLabel="Asignar"
      action={action}
      onSubmit={handleSubmit}
    >
      {done && (
        <Alert variant="success">
          <AlertTitle>Listo</AlertTitle>
          <AlertDescription>
            La persona tiene que cambiarla la próxima vez que ingrese.
          </AlertDescription>
        </Alert>
      )}
      <Field>
        <FieldLabel htmlFor="password">Contraseña inicial nueva</FieldLabel>
        <Input
          id="password"
          name="password"
          type="text"
          autoComplete="off"
          required
          aria-describedby="password-hint"
        />
        <FieldDescription id="password-hint">
          Reemplaza la contraseña actual. La persona la usa para ingresar y la cambia al entrar.
        </FieldDescription>
      </Field>
    </ActionFormPage>
  );
}
