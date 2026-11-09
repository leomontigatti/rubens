import { describe, expect, it } from "vite-plus/test";

import { maxOutboxAttempts, retryAt } from "#/lib/outbox.ts";

describe("retrying a failed send", () => {
  it("waits longer after each failure, and gives up after the last attempt", () => {
    const now = Date.UTC(2099, 0, 5, 12);
    const waits = Array.from({ length: maxOutboxAttempts }, (_, index) => {
      const at = retryAt(index + 1, now);
      return at === null ? null : (at - now) / 60_000;
    });

    expect(waits).toEqual([1, 5, 30, 120, null]);
  });
});
