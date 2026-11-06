import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { rolesLabel } from "#/lib/staff.ts";
import { startNewSession } from "#/lib/session-change.ts";
import { getViewer } from "#/server/account.functions.ts";
import { getSignIn, signInAsDevMember } from "#/server/sign-in.functions.ts";

export const Route = createFileRoute("/ingresar")({
  head: () => ({ meta: [{ title: "Ingresar · Rubens" }] }),
  beforeLoad: async () => {
    const result = await getViewer();
    if (result.ok) {
      throw redirect({ to: "/" });
    }
  },
  loader: () => getSignIn(),
  component: SignIn,
});

function SignIn() {
  const signIn = Route.useLoaderData();
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Ingresar a Rubens</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Clerk's sign-in lands with #134. */}
          {signIn.mode === "dev" ? <DevSignIn members={signIn.members} /> : null}
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * The dev sign-in, with no Clerk key (a fresh clone, the browser suite): pick
 * one of the dev organization's members, no password.
 */
function DevSignIn(props: {
  members: readonly { userId: string; name: string; roles: Parameters<typeof rolesLabel>[0] }[];
}) {
  const router = useRouter();
  const [userId, setUserId] = useState(props.members[0]?.userId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const answer = await serverAnswer("dev-sign-in", shownPath(router), () =>
      signInAsDevMember({ data: { userId } }),
    );
    setPending(false);
    if (!answer) {
      return;
    }
    if (!answer.ok) {
      setError("No pudimos iniciar sesión. Probá de nuevo.");
      return;
    }
    startNewSession("/");
  }

  return (
    <form method="post" className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={error} />
      <Field>
        <FieldLabel htmlFor="member">Miembro</FieldLabel>
        <NativeSelect
          id="member"
          className="w-full"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
        >
          {props.members.map((member) => (
            <NativeSelectOption key={member.userId} value={member.userId}>
              {`${member.name} (${rolesLabel(member.roles)})`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" disabled={pending || !userId}>
        Ingresar
      </Button>
    </form>
  );
}
