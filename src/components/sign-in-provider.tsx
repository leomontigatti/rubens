import { esUY } from "@clerk/localizations";
import { ClerkProvider, SignIn, useClerk } from "@clerk/react";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

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

/** Clerk's sign-in: email, password and, from a new device, the code Clerk emails. */
export function ClerkSignIn() {
  return <SignIn routing="hash" forceRedirectUrl="/" />;
}
