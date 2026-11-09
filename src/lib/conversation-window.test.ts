import { describe, expect, it } from "vite-plus/test";

import { conversationWindowMs, isWindowOpen, windowClosesAt } from "#/lib/conversation-window.ts";

const lastIncomingAt = Date.parse("2099-01-05T12:00:00Z");

describe("the conversation window", () => {
  it("closes 24 hours after the patient's last message", () => {
    expect(windowClosesAt(lastIncomingAt)).toBe(Date.parse("2099-01-06T12:00:00Z"));
  });

  it("is open until it closes, and closed from then on", () => {
    expect(isWindowOpen(lastIncomingAt, lastIncomingAt)).toBe(true);
    expect(isWindowOpen(lastIncomingAt, lastIncomingAt + conversationWindowMs - 1)).toBe(true);
    expect(isWindowOpen(lastIncomingAt, lastIncomingAt + conversationWindowMs)).toBe(false);
  });

  it("was never opened by a conversation the patient has not written in", () => {
    expect(windowClosesAt(null)).toBeNull();
    expect(isWindowOpen(null, lastIncomingAt)).toBe(false);
  });
});
