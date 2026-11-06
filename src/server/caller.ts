import { createClerkClient } from "@clerk/backend";

import type { Caller } from "#/organization/members.ts";
import type { Organization } from "#/organization/organization.ts";

// The request-to-caller step (#131): the one place a request becomes a caller
// and an organization's object. The organization comes from the verified
// session token's `org` claim, or in dev from the fixed dev organization;
// nothing the browser sends (a header, a parameter, a body) can name another.

/** The Worker's bindings, vars and secrets (`wrangler.jsonc`). */
export interface WorkerEnv {
  ORGANIZATION: DurableObjectNamespace<Organization>;
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  /**
   * `"true"` serves the dev sign-in from a build, for the browser suite, which
   * drives the production build with no keys. Never set on a deployed Worker.
   */
  DEV_SIGN_IN?: string;
  /** The bearer token the setup script sends; with none, setup is not served (`organization-setup.ts`). */
  SETUP_SECRET?: string;
  /** The secret the agenda week seed asks for outside dev; with none, it is not served (`agenda-week-seed.ts`). */
  SEED_SECRET?: string;
}

/** `clerk` with a Clerk secret; `dev`, the sign-in that picks a seeded member, otherwise. */
export type AuthMode = "clerk" | "dev";

/**
 * Which sign-in the Worker uses. Without a Clerk secret it is the dev sign-in,
 * on the dev server or with `DEV_SIGN_IN`; anywhere else, a deployed Worker
 * among them, it throws, so production refuses to run in dev mode.
 */
export function authMode(env: WorkerEnv, devServer: boolean): AuthMode {
  if (env.CLERK_SECRET_KEY) {
    return "clerk";
  }
  if (devServer || env.DEV_SIGN_IN === "true") {
    return "dev";
  }
  throw new Error(
    "CLERK_SECRET_KEY is required outside dev: set it with `wrangler secret put CLERK_SECRET_KEY`",
  );
}

/** The organization every dev sign-in belongs to: the dev seed's (`src/dev/seed.ts`). */
export const devOrganizationId = "dev-organization";

/** The dev sign-in's cookie: the signed-in member's user id. */
export const devUserCookie = "rubens_dev_user";

/** A verified session's user and its `org` claim, as the token carries it; null when signed out. */
export type VerifySession = (
  request: Request,
) => Promise<{ userId: string; organizationClaim: unknown } | null>;

/** Verifies the Clerk session token of a request (its `__session` cookie or `Authorization` header). */
export function clerkSession(env: WorkerEnv): VerifySession {
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  });
  return async (request) => {
    const state = await clerk.authenticateRequest(request, { acceptsToken: "session_token" });
    if (!state.isAuthenticated) {
      return null;
    }
    const auth = state.toAuth();
    return { userId: auth.userId, organizationClaim: auth.sessionClaims.org };
  };
}

function cookieOf(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return undefined;
}

/**
 * An organization's object. `locationHint: "sam"` asks for South America;
 * Cloudflare creates objects hinted there in the US East today (ADR-0008). The
 * hint applies only when the object is first created.
 */
export function organizationObject(env: WorkerEnv, organizationId: string) {
  return env.ORGANIZATION.get(env.ORGANIZATION.idFromName(organizationId), {
    locationHint: "sam",
  });
}

export type ResolvedCaller =
  | {
      ok: true;
      caller: Caller;
      organizationId: string;
      organization: DurableObjectStub<Organization>;
    }
  | { ok: false; reason: "unauthenticated" };

/**
 * The caller of `request` and their organization's object: in `clerk` mode
 * from the verified session token, in `dev` mode from the dev sign-in's
 * cookie. A request with neither, or a token with no organization, is
 * refused.
 */
export async function resolveCaller(
  request: Request,
  env: WorkerEnv,
  mode: AuthMode,
  verifySession: VerifySession,
): Promise<ResolvedCaller> {
  let userId: string | undefined;
  let organizationId: string | undefined;
  if (mode === "clerk") {
    const session = await verifySession(request);
    userId = session?.userId;
    const claim = session?.organizationClaim;
    organizationId = typeof claim === "string" && claim ? claim : undefined;
  } else {
    userId = cookieOf(request, devUserCookie) || undefined;
    organizationId = devOrganizationId;
  }
  if (!userId || !organizationId) {
    return { ok: false, reason: "unauthenticated" };
  }
  return {
    ok: true,
    caller: { userId },
    organizationId,
    organization: organizationObject(env, organizationId),
  };
}
