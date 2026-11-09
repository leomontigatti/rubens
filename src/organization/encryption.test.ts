import { describe, expect, it } from "vite-plus/test";

import { organizationCipher } from "#/organization/encryption.ts";

const secret = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

async function cipherOf(organizationId: string) {
  const cipher = await organizationCipher(secret, organizationId);
  if (!cipher) {
    throw new Error("expected a cipher");
  }
  return cipher;
}

describe("the organization's cipher", () => {
  it("opens what it sealed, and the sealed value does not hold the plaintext", async () => {
    const cipher = await cipherOf("org-a");

    const sealed = await cipher.seal("EAAG-token", "whatsappAccessToken");

    expect(sealed).not.toContain("EAAG-token");
    expect(await cipher.open(sealed, "whatsappAccessToken")).toBe("EAAG-token");
  });

  it("seals the same value differently each time", async () => {
    const cipher = await cipherOf("org-a");

    expect(await cipher.seal("same", "whatsappPin")).not.toBe(
      await cipher.seal("same", "whatsappPin"),
    );
  });

  it("does not open a value sealed for another organization", async () => {
    const sealed = await (await cipherOf("org-a")).seal("EAAG-token", "whatsappAccessToken");

    await expect((await cipherOf("org-b")).open(sealed, "whatsappAccessToken")).rejects.toThrow();
  });

  it("does not open a value sealed as something else", async () => {
    const cipher = await cipherOf("org-a");
    const sealed = await cipher.seal("123456", "whatsappPin");

    await expect(cipher.open(sealed, "whatsappAccessToken")).rejects.toThrow();
  });

  it("is missing without the Worker's key", async () => {
    expect(await organizationCipher(undefined, "org-a")).toBeNull();
  });
});
