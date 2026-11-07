import { createHmac } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { isSignedByMeta } from "#/server/whatsapp-signature.ts";

const appSecret = "the-app-secret";
const body = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[]}');

/** The header Meta sends: `sha256=` and the hex HMAC of the raw body with the app secret. */
function metaSignature(raw: Uint8Array, secret = appSecret) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

describe("Meta's webhook signature", () => {
  it("accepts Meta's HMAC of the raw body", async () => {
    expect(await isSignedByMeta(body, metaSignature(body), appSecret)).toBe(true);
  });

  it("refuses a changed body, a wrong secret, a missing header and a malformed one", async () => {
    const changed = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[1]}');

    const results = await Promise.all([
      isSignedByMeta(changed, metaSignature(body), appSecret),
      isSignedByMeta(body, metaSignature(body, "another-secret"), appSecret),
      isSignedByMeta(body, null, appSecret),
      isSignedByMeta(body, metaSignature(body).replace("sha256=", ""), appSecret),
      isSignedByMeta(body, "sha256=zz", appSecret),
    ]);

    expect(results).toEqual([false, false, false, false, false]);
  });
});
