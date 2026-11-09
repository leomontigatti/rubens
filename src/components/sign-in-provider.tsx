import { esUY } from "@clerk/localizations";
import { ClerkProvider, SignIn, useAuth, useClerk } from "@clerk/react";
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import { startNewSession } from "#/lib/session-change.ts";
import { signOutOfDev } from "#/server/sign-in.functions.ts";

// The sign-in the Worker serves (`src/server/caller.ts`): Clerk's, with its
// publishable key, or the dev sign-in. Every page sits under this provider:
// with Clerk, its script keeps the session token fresh in the browser.

export type SignInConfig = { mode: "clerk"; publishableKey: string } | { mode: "dev" };

const SignOutContext = createContext<() => Promise<unknown>>(() => signOutOfDev());

/** Ends the signed-in member's session, Clerk's or the dev sign-in's. */
export function useSignOut() {
  return useContext(SignOutContext);
}

export function SignInProvider(props: { config: SignInConfig; children: ReactNode }) {
  if (props.config.mode === "dev") {
    return props.children;
  }
  return (
    <ClerkProvider publishableKey={props.config.publishableKey} localization={esUY}>
      <ClerkSignOut>{props.children}</ClerkSignOut>
    </ClerkProvider>
  );
}

function ClerkSignOut(props: { children: ReactNode }) {
  const clerk = useClerk();
  return <SignOutContext value={() => clerk.signOut()}>{props.children}</SignOutContext>;
}

/**
 * Clerk's sign-in: email, password and, from a new device, the code Clerk
 * emails; signing in lands on `returnTo`. Someone who arrives already signed
 * in to Clerk was refused by the server (no active member, or no
 * organization): they get a way to sign out, since Clerk's form would send
 * them straight back to a page that sends them here.
 */
export function ClerkSignIn(props: { returnTo: string }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [signedInOnArrival, setSignedInOnArrival] = useState<boolean | undefined>(undefined);
  if (isLoaded && signedInOnArrival === undefined) {
    setSignedInOnArrival(isSignedIn);
  }
  if (signedInOnArrival) {
    return <RefusedAccount />;
  }
  return <SignIn routing="hash" forceRedirectUrl={props.returnTo} />;
}

function RefusedAccount() {
  const signOut = useSignOut();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    await signOut();
    startNewSession("/ingresar");
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sin acceso a underthing</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">
          Tu cuenta no tiene acceso a underthing, o fue desactivada. Cerrá la sesión para ingresar
          con otra cuenta.
        </p>
        <Button type="button" disabled={pending} onClick={() => void handleSignOut()}>
          Cerrar sesión
        </Button>
      </CardContent>
    </Card>
  );
}
