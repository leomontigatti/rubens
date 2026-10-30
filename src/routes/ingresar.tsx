import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { startNewSession } from "#/lib/session-change.ts";
import { readCredentials, signInErrorMessage } from "#/lib/sign-in.ts";
import { getViewer } from "#/server/account.functions.ts";

export const Route = createFileRoute("/ingresar")({
  head: () => ({ meta: [{ title: "Ingresar · Rubens" }] }),
  beforeLoad: async () => {
    const result = await getViewer();
    if (result.ok) {
      throw redirect({ to: "/" });
    }
  },
  component: SignIn,
});

function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = readCredentials(Object.fromEntries(new FormData(event.currentTarget)));
    if (!read.ok) {
      setError(read.message);
      return;
    }
    setPending(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email(read.credentials);
    setPending(false);
    if (signInError) {
      setError(signInErrorMessage(signInError.status));
      return;
    }
    startNewSession("/");
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Ingresar a Rubens</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <ErrorAlert message={error} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" disabled={pending}>
              Ingresar
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
