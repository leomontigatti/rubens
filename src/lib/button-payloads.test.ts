import { describe, expect, it } from "vite-plus/test";

import { confirmPayload, readButtonPayload, reopenPayload } from "#/lib/button-payloads.ts";

const appointmentId = "0b7d6f43-3c64-4f0e-9a51-7a2f1d3c9e10";

describe("a quick-reply button's payload", () => {
  it("reads back the appointment and start a confirm button was sent for, and the reopen button", () => {
    expect(readButtonPayload(confirmPayload(appointmentId, 4071240000000))).toEqual({
      kind: "confirm",
      appointmentId,
      startsAt: 4071240000000,
    });
    expect(readButtonPayload(reopenPayload())).toEqual({ kind: "reopen" });
  });

  it("reads anything else as no payload of underthing's", () => {
    for (const payload of [
      "",
      "confirm",
      `confirm:${appointmentId}`,
      `confirm:not-an-id:4071240000000`,
      `confirm:${appointmentId}:soon`,
      `confirm:${appointmentId}:4071240000000:extra`,
      "reopen:something",
      "cancel:whatever",
    ]) {
      expect(readButtonPayload(payload), payload).toBeNull();
    }
  });
});
