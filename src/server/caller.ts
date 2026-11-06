import { createClerkClient } from "@clerk/backend";
import type { RequestState } from "@clerk/backend/internal";

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

/** What Clerk made of a request: who it is, and the headers of a redirect it asks for. */
type ClerkRequestState = RequestState<"session_token">;

/**
 * Each request is authenticated once: the page-load check in `src/server.ts`
 * and every server function a page's loaders call share the request object,
 * so they share the answer.
 */
const authenticated = new WeakMap<Request, Promise<ClerkRequestState>>();

function authenticate(env: WorkerEnv, request: Request): Promise<ClerkRequestState> {
  let state = authenticated.get(request);
  if (!state) {
    const clerk = createClerkClient({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
    });
    // Only tokens issued for this app's own origin are accepted.
    state = clerk.authenticateRequest(request, {
      acceptsToken: "session_token",
      authorizedParties: [new URL(request.url).origin],
    });
    authenticated.set(request, state);
  }
  return state;
}

/** Verifies the Clerk session token of a request (its `__session` cookie or `Authorization` header). */
export function clerkSession(env: WorkerEnv): VerifySession {
  return async (request) => {
    const state = await authenticate(env, request);
    if (!state.isAuthenticated) {
      return null;
    }
    const auth = state.toAuth();
    return { userId: auth.userId, organizationClaim: auth.sessionClaims.org };
  };
}

/** Whether `request` is the browser loading a page, not a script's fetch. */
function isPageLoad(request: Request): boolean {
  if (request.method !== "GET") {
    return false;
  }
  const destination = request.headers.get("sec-fetch-dest");
  return destination
    ? destination === "document"
    : (request.headers.get("accept") ?? "").includes("text/html");
}

/**
 * The redirect a page load needs before it renders, when Clerk asks for one:
 * its handshake, which refreshes an expired session token and comes back to
 * the same page. Anything else, a script's request included, needs none.
 */
export async function pageLoadRedirect(
  request: Request,
  check: (request: Request) => Promise<{ headers: Headers }>,
): Promise<Response | null> {
  if (!isPageLoad(request)) {
    return null;
  }
  const { headers } = await check(request);
  return headers.get("location") ? new Response(null, { status: 307, headers }) : null;
}

/** `pageLoadRedirect` with Clerk's answer for the request. */
export function clerkPageLoadRedirect(request: Request, env: WorkerEnv) {
  return pageLoadRedirect(request, (checked) => authenticate(env, checked));
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
