import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { organizationCipher } from "#/organization/encryption.ts";
import {
  freshOrganization,
  inStorage,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import { rejectedWebhookEvent } from "#/organization/webhook-schema.ts";

// What the object keeps of a webhook call's elements the Worker could not
// read: sealed, for 30 days. Which elements those are is the webhook's suite's.

const dayMs = 24 * 60 * 60_000;

/** The workers project's `ORGANIZATION_ENCRYPTION_KEY` (`vite.config.ts`). */
const workersKey = btoa("k".repeat(32));

const unreadable = JSON.stringify({
  from: "+54 9 351 444-0001",
  id: "wamid.unreadable",
  timestamp: "4071240001",
  type: "text",
  text: { body: "Quería cambiar el turno" },
});

function storedRejected(organization: ReturnType<typeof freshOrganization>["organization"]) {
  return inStorage(organization, (database) => database.select().from(rejectedWebhookEvent).all());
}

beforeEach(() => {
  // Before the runtime's own clock, so the retention's alarm fires only when a test runs it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2098-12-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a webhook element the Worker could not read", () => {
  it("is kept sealed with the organization's key, with where its shape broke", async () => {
    const { organizationId, organization } = await setUpTestOrganization();

    const stored = await organization.storeRejectedWebhookEvents([
      { element: unreadable, issues: ["from"] },
    ]);

    expect(stored).toEqual({ ok: true, stored: 1 });
    const [row] = await storedRejected(organization);
    expect(row?.issues).toEqual(["from"]);
    expect(row?.element).not.toContain("Quería");
    const cipher = await organizationCipher(workersKey, organizationId);
    expect(await cipher?.open(row!.element, "rejectedWebhookEvent")).toBe(unreadable);
  });

  it("is deleted 30 days after it was kept", async () => {
    const { organization } = await setUpTestOrganization();
    const keptAt = Date.now();
    await organization.storeRejectedWebhookEvents([{ element: unreadable, issues: ["from"] }]);
    const alarm = await runInDurableObject(organization, (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBe(keptAt + 30 * dayMs);

    vi.setSystemTime(keptAt + 30 * dayMs);
    await runDurableObjectAlarm(organization);

    expect(await storedRejected(organization)).toEqual([]);
  });

  it("is refused by an object no organization was set up in", async () => {
    const { organization } = freshOrganization();

    expect(
      await organization.storeRejectedWebhookEvents([{ element: unreadable, issues: ["from"] }]),
    ).toEqual({ ok: false, reason: "notSetUp" });
  });
});
