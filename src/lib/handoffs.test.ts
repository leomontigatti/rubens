import { describe, expect, it } from "vite-plus/test";

import { handoffRemindersSchema } from "#/lib/handoffs.ts";

describe("the handoff reminders' hours", () => {
  it("may not go as many hours before the close as the window lasts", () => {
    const accepts = (recipientHours: number) =>
      handoffRemindersSchema.safeParse({ recipientHours, othersHours: 1 }).success;

    expect(accepts(23)).toBe(true);
    expect(accepts(24)).toBe(false);
  });
});
