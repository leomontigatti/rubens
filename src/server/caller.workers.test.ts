import { env } from "cloudflare:test";
import { describe, expect, it } from "vite-plus/test";

import {
  authMode,
  devOrganizationId,
  devUserCookie,
  servePageLoad,
  signedOutSession,
  resolveCaller,
} from "#/server/caller.ts";
import type { VerifySession, WorkerEnv } from "#/server/caller.ts";

const bindings = env as unknown as WorkerEnv;

const idOf = (organizationId: string) =>
  bindings.ORGANIZATION.idFromName(organizationId).toString();

/** A Clerk session verifier that accepts one token, as Clerk would after checking it. */
function verifierFor(token: string, session: { userId: string; organizationClaim: unknown }) {
  const verify: VerifySession = (request) =>
    Promise.resolve(request.headers.get("authorization") === `Bearer ${token}` ? session : null);
  return verify;
}

const noSession: VerifySession = () => Promise.resolve(null);

function request(headers: Record<string, string> = {}, url = "https://underthing.test/agenda") {
  return new Request(url, { headers });
}

describe("the request-to-caller step, with Clerk", () => {
  const verify = verifierFor("good-token", { userId: "user-1", organizationClaim: "org-a" });

  it("takes the caller and the organization from the verified session", async () => {
    const resolved = await resolveCaller(
      request({ authorization: "Bearer good-token" }),
      bindings,
      "clerk",
      verify,
    );

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.caller).toEqual({ userId: "user-1" });
      expect(resolved.organizationId).toBe("org-a");
      expect(resolved.organization.id.toString()).toBe(idOf("org-a"));
    }
  });

  it("ignores any organization the browser names", async () => {
    const resolved = await resolveCaller(
      request(
        { authorization: "Bearer good-token", "x-organization": "org-b", cookie: "org=org-b" },
        "https://underthing.test/agenda?organizationId=org-b",
      ),
      bindings,
      "clerk",
      verify,
    );

    expect(resolved.ok && resolved.organizationId).toBe("org-a");
  });

  it("refuses a request whose token does not verify", async () => {
    const resolved = await resolveCaller(
      request({ authorization: "Bearer forged-token" }),
      bindings,
      "clerk",
      verify,
    );

    expect(resolved).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("refuses a verified session with no organization claim", async () => {
    const resolved = await resolveCaller(
      request({ authorization: "Bearer good-token" }),
      bindings,
      "clerk",
      verifierFor("good-token", { userId: "user-1", organizationClaim: "" }),
    );

    expect(resolved).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("refuses the dev sign-in's cookie", async () => {
    const resolved = await resolveCaller(
      request({ cookie: `${devUserCookie}=user-1` }),
      bindings,
      "clerk",
      noSession,
    );

    expect(resolved).toEqual({ ok: false, reason: "unauthenticated" });
  });
});

describe("the request-to-caller step, in dev", () => {
  it("takes the caller from the dev cookie, in the dev organization", async () => {
    const resolved = await resolveCaller(
      request({ cookie: `other=1; ${devUserCookie}=user-2` }),
      bindings,
      "dev",
      noSession,
    );

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.caller).toEqual({ userId: "user-2" });
      expect(resolved.organization.id.toString()).toBe(idOf(devOrganizationId));
    }
  });

  it("ignores a session token", async () => {
    const resolved = await resolveCaller(
      request({ authorization: "Bearer good-token" }),
      bindings,
      "dev",
      verifierFor("good-token", { userId: "user-1", organizationClaim: "org-a" }),
    );

    expect(resolved).toEqual({ ok: false, reason: "unauthenticated" });
  });
});

describe("the sign-in mode", () => {
  const base = { ORGANIZATION: bindings.ORGANIZATION };

  it("is Clerk's with a Clerk secret, even on the dev server", () => {
    expect(authMode({ ...base, CLERK_SECRET_KEY: "sk_test_x" }, true)).toBe("clerk");
  });

  it("is the dev sign-in with no Clerk secret on the dev server, or with DEV_SIGN_IN", () => {
    expect(authMode(base, true)).toBe("dev");
    expect(authMode({ ...base, DEV_SIGN_IN: "true" }, false)).toBe("dev");
  });

  it("refuses to run a build with no Clerk secret and no DEV_SIGN_IN", () => {
    expect(() => authMode(base, false)).toThrow(/CLERK_SECRET_KEY/);
  });
});

describe("a page load whose session token Clerk must refresh", () => {
  const handshake = new Headers({
    location:
      "https://clerk.underthing.test/v1/client/handshake?redirect_url=https%3A%2F%2Funderthing.test%2Fagenda",
    "set-cookie": "__clerk_handshake_nonce=n; Path=/",
  });
  const asksForHandshake = () => Promise.resolve({ headers: handshake });
  const asksForNothing = () => Promise.resolve({ headers: new Headers() });
  const render = () =>
    Promise.resolve(
      new Response("<html>agenda</html>", { headers: { "content-type": "text/html" } }),
    );

  it("is sent through Clerk's handshake before it renders, with Clerk's headers", async () => {
    const response = await servePageLoad(
      request({ "sec-fetch-dest": "document" }),
      asksForHandshake,
      render,
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(handshake.get("location"));
    expect(response.headers.get("set-cookie")).toBe(handshake.get("set-cookie"));
  });

  it("counts a request asking for HTML as a page load when the browser names no destination", async () => {
    const response = await servePageLoad(
      request({ accept: "text/html,application/xhtml+xml" }),
      asksForHandshake,
      render,
    );

    expect(response.status).toBe(307);
  });

  it("renders a page load with a valid token as it is", async () => {
    const response = await servePageLoad(
      request({ "sec-fetch-dest": "document" }),
      asksForNothing,
      render,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>agenda</html>");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("renders the page with the session cookies Clerk refreshed without a redirect", async () => {
    // A production instance answers the handshake with the new cookies and no Location.
    const refreshed = new Headers();
    refreshed.append("set-cookie", "__session=fresh; Path=/; Secure");
    refreshed.append("set-cookie", "__client_uat=1; Path=/; Secure");

    const response = await servePageLoad(
      request({ "sec-fetch-dest": "document" }),
      () => Promise.resolve({ headers: refreshed }),
      render,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>agenda</html>");
    expect(response.headers.getSetCookie()).toEqual([
      "__session=fresh; Path=/; Secure",
      "__client_uat=1; Path=/; Secure",
    ]);
  });

  it("leaves a script's request to the server functions, without asking Clerk", async () => {
    let asked = false;
    const response = await servePageLoad(
      request({ "sec-fetch-dest": "empty", accept: "application/json" }),
      () => {
        asked = true;
        return asksForHandshake();
      },
      render,
    );

    expect(response.status).toBe(200);
    expect(asked).toBe(false);
  });
});

describe("a request Clerk answers as signed out", () => {
  it("has no session when Clerk found no valid token", () => {
    expect(signedOutSession("session-token-and-uat-missing")).toBeNull();
    expect(signedOutSession("token-expired")).toBeNull();
    expect(signedOutSession("token-invalid-signature")).toBeNull();
  });

  // Clerk reports its own failures as signed out too: a member must then see
  // an error to retry, not "no access" with a sign-out.
  it("fails when Clerk could not check the token", () => {
    expect(() => signedOutSession("jwk-remote-failed-to-load")).toThrow(/could not verify/);
    expect(() => signedOutSession("jwk-failed-to-resolve")).toThrow(/could not verify/);
    expect(() => signedOutSession("unexpected-error")).toThrow(/could not verify/);
  });
});
