import { auth } from "@clerk/tanstack-react-start/server";
import { env as workerEnv } from "cloudflare:workers";

import { type Caller, parseRoles } from "./access";
import type { Env } from "./env";
import { devCookie, devOrganizationId, staff } from "./staff";

export const env = workerEnv as unknown as Env;

/**
 * `clerk` when a Clerk secret key is set; else, outside production, `dev`: a sign-in that
 * picks one of the seeded staff, so a fresh clone runs with no keys and no account.
 * A production build refuses to run without the key.
 */
export function authMode(): "clerk" | "dev" {
  if (env.CLERK_SECRET_KEY) return "clerk";
  if (import.meta.env.DEV) return "dev";
  throw new Error("CLERK_SECRET_KEY is required in production (wrangler secret put CLERK_SECRET_KEY)");
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
}

/** The session's user, active organization and roles, or null when signed out. */
export async function callerFrom(request: Request): Promise<Caller | null> {
  if (authMode() === "clerk") {
    // clerkMiddleware (src/start.ts) verified the session token: networkless, against the
    // instance's JWKS, which it caches.
    const session = await auth();
    if (!session.userId || !session.orgId) return null;
    return {
      userId: session.userId,
      organizationId: session.orgId,
      roles: parseRoles(session.sessionClaims?.roles),
    };
  }
  const person = staff.find((p) => p.devId === cookie(request, devCookie));
  if (!person) return null;
  return { userId: person.devId, organizationId: devOrganizationId, roles: person.roles };
}
