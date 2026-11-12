import { describe, expect, it } from "vite-plus/test";

import { fakesModel } from "#/dev/fake-model.ts";

describe("the fake model of a browser check", () => {
  it("runs only when asked for and with no Clerk secret, so never on a deployed Worker", () => {
    expect(fakesModel({ ASSISTANT_FAKE_MODEL: "true" })).toBe(true);
    expect(fakesModel({ ASSISTANT_FAKE_MODEL: "true", CLERK_SECRET_KEY: "sk_live_x" })).toBe(false);
    expect(fakesModel({})).toBe(false);
  });
});
