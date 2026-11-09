import { describe, expect, it } from "vite-plus/test";

import { fakeMetaFetch, fakesMeta } from "#/dev/fake-meta.ts";

describe("the fake Meta of the browser suite", () => {
  it("runs only when asked for and with no Clerk secret, so never on a deployed Worker", () => {
    expect(fakesMeta({ WHATSAPP_FAKE_META: "true" })).toBe(true);
    expect(fakesMeta({ WHATSAPP_FAKE_META: "true", CLERK_SECRET_KEY: "sk_live_x" })).toBe(false);
    expect(fakesMeta({})).toBe(false);
  });

  it("accepts each message with an id of its own, and refuses any other call", async () => {
    const send = async () => {
      const sent = await fakeMetaFetch("https://graph.facebook.com/v26.0/1/messages", {
        method: "POST",
        body: JSON.stringify({ to: "5493514000001", type: "text" }),
      });
      expect(sent.status).toBe(200);
      return ((await sent.json()) as { messages: { id: string }[] }).messages[0]!.id;
    };
    // Two messages with one id would be stored as one: the id is unique per message.
    expect(await send()).not.toBe(await send());

    const other = await fakeMetaFetch("https://graph.facebook.com/v26.0/1/message_templates");
    expect(other.status).toBe(400);
  });
});
