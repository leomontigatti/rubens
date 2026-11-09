import { describe, expect, it } from "vite-plus/test";

import { signupEventOf, signupOutcomeOf } from "#/lib/embedded-signup.ts";

const finish = JSON.stringify({
  type: "WA_EMBEDDED_SIGNUP",
  event: "FINISH",
  data: { phone_number_id: "106540352242922", waba_id: "102290129340398", business_id: "1" },
});

describe("Embedded Signup's message to the page", () => {
  it("reads the number and the account a finished signup connected", () => {
    expect(signupEventOf("https://www.facebook.com", finish)).toEqual({
      kind: "finished",
      phoneNumberId: "106540352242922",
      businessAccountId: "102290129340398",
    });
  });

  it.each(["https://evil.example", "https://facebook.com.evil.example", "https://notfacebook.com"])(
    "ignores a message from %s",
    (origin) => {
      expect(signupEventOf(origin, finish)).toBeNull();
    },
  );

  it("ignores Facebook's other messages and data that is not JSON", () => {
    expect(signupEventOf("https://www.facebook.com", "not json")).toBeNull();
    expect(signupEventOf("https://www.facebook.com", JSON.stringify({ type: "OTHER" }))).toBeNull();
    expect(signupEventOf("https://www.facebook.com", { type: "WA_EMBEDDED_SIGNUP" })).toBeNull();
  });

  it("reads a cancelled signup, and an error with Meta's message", () => {
    const message = (event: string, data: object) =>
      JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, data });

    expect(
      signupEventOf("https://web.facebook.com", message("CANCEL", { current_step: "PHONE" })),
    ).toEqual({ kind: "cancelled" });
    expect(
      signupEventOf("https://www.facebook.com", message("ERROR", { error_message: "Algo falló" })),
    ).toEqual({ kind: "failed", message: "Algo falló" });
  });

  it("treats a finish without a number, such as an account only, as not connecting one", () => {
    const onlyAccount = JSON.stringify({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_ONLY_WABA",
      data: { waba_id: "102290129340398" },
    });

    expect(signupEventOf("https://www.facebook.com", onlyAccount)).toEqual({
      kind: "failed",
      message: null,
    });
  });
});

describe("how Embedded Signup ended", () => {
  const finished = {
    kind: "finished",
    phoneNumberId: "106540352242922",
    businessAccountId: "102290129340398",
  } as const;

  it("completes with the code and the number, whichever came first", () => {
    expect(signupOutcomeOf("the-code", finished)).toEqual({
      kind: "completed",
      completion: {
        code: "the-code",
        phoneNumberId: "106540352242922",
        businessAccountId: "102290129340398",
      },
    });
  });

  it("waits for the popup's message when only the code has come", () => {
    expect(signupOutcomeOf("the-code", null)).toBeNull();
  });

  it("is cancelled when the popup closed without a code, even after finishing", () => {
    expect(signupOutcomeOf(null, null)).toEqual({ kind: "cancelled" });
    expect(signupOutcomeOf(null, finished)).toEqual({ kind: "cancelled" });
    expect(signupOutcomeOf("the-code", { kind: "cancelled" })).toEqual({ kind: "cancelled" });
  });

  it("fails with Meta's message, code or not", () => {
    const failed = { kind: "failed", message: "Algo falló" } as const;

    expect(signupOutcomeOf("the-code", failed)).toEqual(failed);
    expect(signupOutcomeOf(null, failed)).toEqual(failed);
  });
});
