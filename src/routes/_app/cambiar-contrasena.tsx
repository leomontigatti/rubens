import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { passwordChangeSchema } from "#/lib/password-change.ts";
import { changePassword } from "#/server/account.functions.ts";

export const Route = createFileRoute("/_app/cambiar-contrasena")({
  head: () => ({ meta: [{ title: "Cambiar contraseña · Rubens" }] }),
  component: ChangePassword,
});

const messages = {
  invalid: "La contraseña nueva debe tener entre 8 y 128 caracteres.",
  mismatch: "Las contraseñas nuevas no coinciden.",
  passwordTooShort: "La contraseña nueva debe tener entre 8 y 128 caracteres.",
  passwordTooLong: "La contraseña nueva debe tener entre 8 y 128 caracteres.",
  wrongPassword: "La contraseña actual no es correcta.",
  samePassword: "La contraseña nueva tiene que ser distinta de la actual.",
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "No tenés permiso para hacer esto.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
};

function ChangePassword() {
  const { viewer } = Route.useRouteContext();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("newPassword") !== form.get("confirmPassword")) {
      setError(messages.mismatch);
      return;
    }
    const input = passwordChangeSchema.safeParse({
      currentPassword: form.get("currentPassword"),
      newPassword: form.get("newPassword"),
    });
    if (!input.success) {
      setError(messages.invalid);
      return;
    }
    setPending(true);
    setError(null);
    const result = await changePassword({ data: input.data });
    setPending(false);
    if (!result.ok) {
      setError(messages[result.reason]);
      return;
    }
    await router.invalidate();
    await router.navigate({ to: "/" });
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Cambiar contraseña</CardTitle>
        {viewer.mustChangePassword && (
          <CardDescription>
            Elegí una contraseña nueva para reemplazar la contraseña inicial.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <form method="post" className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <ErrorAlert message={error} />
          <Field>
            <FieldLabel htmlFor="currentPassword">Contraseña actual</FieldLabel>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="newPassword">Contraseña nueva</FieldLabel>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="confirmPassword">Repetí la contraseña nueva</FieldLabel>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
            />
          </Field>
          <Button type="submit" disabled={pending}>
            Guardar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
