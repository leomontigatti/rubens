import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import * as z from "zod";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { ClerkSignIn } from "#/components/sign-in-provider.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { rolesLabel } from "#/lib/staff.ts";
import { startNewSession } from "#/lib/session-change.ts";
import { getViewer } from "#/server/account.functions.ts";
import { getSignIn, signInAsDevMember } from "#/server/sign-in.functions.ts";

/**
 * `volver` is the page asked for before signing in, which signing in lands on:
 * a path of this app only, so a link cannot send the member elsewhere.
 */
const searchSchema = z.object({
  volver: z
    .string()
    .regex(/^\/(?![/\\])/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute("/ingresar")({
  head: () => ({ meta: [{ title: "Ingresar · Rubens" }] }),
  validateSearch: searchSchema,
  beforeLoad: async ({ search }) => {
    const result = await getViewer();
    if (result.ok) {
      throw redirect({ href: search.volver ?? "/" });
    }
  },
  loader: () => getSignIn(),
  component: SignIn,
});

function SignIn() {
  const signIn = Route.useLoaderData();
  const returnTo = Route.useSearch().volver ?? "/";
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      {signIn.mode === "dev" ? (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Ingresar a Rubens</CardTitle>
          </CardHeader>
          <CardContent>
            <DevSignIn members={signIn.members} returnTo={returnTo} />
          </CardContent>
        </Card>
      ) : (
        <ClerkSignIn returnTo={returnTo} />
      )}
    </main>
  );
}

/**
 * The dev sign-in, with no Clerk key (a fresh clone, the browser suite): pick
 * one of the dev organization's members, no password.
 */
function DevSignIn(props: {
  members: readonly { userId: string; name: string; roles: Parameters<typeof rolesLabel>[0] }[];
  returnTo: string;
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
    startNewSession(props.returnTo);
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
