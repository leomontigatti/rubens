// What the sign-in page makes of the server's answer to who is signed in. Only
// `unauthenticated` means the request carries no member: someone signed in to
// Clerk then has no access to underthing, and is told so. Any other refusal is a
// failure, shown as an error to retry, never as "no access".

export type SignInArrival = "signedIn" | "noAccess" | "failed";

export function signInArrival(answer: { ok: true } | { ok: false; reason: string }): SignInArrival {
  if (answer.ok) {
    return "signedIn";
  }
  return answer.reason === "unauthenticated" ? "noAccess" : "failed";
}
