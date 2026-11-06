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

/**
 * Clerk's signed-out reasons that mean it could not check the token at all
 * (its signing keys did not load, or it failed unexpectedly), not that the
 * request has no valid session.
 */
const verificationFailures = new Set<string>([
  "jwk-remote-failed-to-load",
  "jwk-failed-to-resolve",
  "jwk-remote-invalid",
  "jwk-remote-missing",
  "unexpected-error",
]);

/**
 * A signed-out answer from Clerk: no session, or a throw when Clerk could not
 * verify the token, so the member sees an error to retry rather than being
 * told they have no access.
 */
export function signedOutSession(reason: string | null): null {
  if (reason && verificationFailures.has(reason)) {
    throw new Error(`[clerk] could not verify the session token: ${reason}`);
  }
  return null;
}

/** Verifies the Clerk session token of a request (its `__session` cookie or `Authorization` header). */
export function clerkSession(env: WorkerEnv): VerifySession {
  return async (request) => {
    const state = await authenticate(env, request);
    if (!state.isAuthenticated) {
      return signedOutSession(state.reason);
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
 * Serves a page load past Clerk first. When Clerk asks for its handshake,
 * which refreshes an expired session token and comes back to the same page,
 * the browser is sent there instead of the page rendering signed out. When
 * Clerk refreshed the session cookies itself (a production instance does,
 * with no redirect), the rendered page carries them, or the browser would keep
 * the expired token and go through the handshake again. Anything else, a
 * script's request included, is rendered without asking Clerk.
 */
export async function servePageLoad(
  request: Request,
  check: (request: Request) => Promise<{ headers: Headers }>,
  render: (request: Request) => Response | Promise<Response>,
): Promise<Response> {
  if (!isPageLoad(request)) {
    return render(request);
  }
  const { headers } = await check(request);
  if (headers.get("location")) {
    return new Response(null, { status: 307, headers });
  }
  const cookies = headers.getSetCookie();
  const rendered = await render(request);
  if (cookies.length === 0) {
    return rendered;
  }
  const response = new Response(rendered.body, rendered);
  for (const cookie of cookies) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

/** `servePageLoad` with Clerk's answer for the request. */
export function serveClerkPageLoad(
  request: Request,
  env: WorkerEnv,
  render: (request: Request) => Response | Promise<Response>,
) {
  return servePageLoad(request, (checked) => authenticate(env, checked), render);
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
