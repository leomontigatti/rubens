// What the sign-in page makes of the server's answer to who is signed in.

export type SignInArrival = "signedIn" | "noAccess" | "failed";

export function signInArrival(answer: { ok: true } | { ok: false; reason: string }): SignInArrival {
  if (answer.ok) {
    return "signedIn";
  }
  return answer.reason === "unauthenticated" ? "noAccess" : "failed";
}
