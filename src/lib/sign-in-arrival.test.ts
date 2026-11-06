import { describe, expect, it } from "vite-plus/test";

import { signInArrival } from "#/lib/sign-in-arrival.ts";

describe("what the sign-in page makes of the server's answer to who is signed in", () => {
  it("sends a signed-in member on", () => {
    expect(signInArrival({ ok: true })).toBe("signedIn");
  });

  it("counts only an answer of unauthenticated as no access", () => {
    expect(signInArrival({ ok: false, reason: "unauthenticated" })).toBe("noAccess");
  });

  it("counts any other refusal as a failure, not as no access", () => {
    expect(signInArrival({ ok: false, reason: "forbidden" })).toBe("failed");
    expect(signInArrival({ ok: false, reason: "mustChangePassword" })).toBe("failed");
  });
});
