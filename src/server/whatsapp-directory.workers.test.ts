import { describe, expect, it } from "vite-plus/test";

import { freshWhatsappDirectory } from "#/organization/organization.test-support.ts";

const number = { phoneNumberId: "106540352242922", businessAccountId: "102290129340398" };

describe("the WhatsApp directory", () => {
  it("finds the organization of a connected number and of its account", async () => {
    const directory = freshWhatsappDirectory();

    expect(await directory.claim({ ...number, organizationId: "org-a" })).toEqual({ ok: true });

    expect(await directory.organizationForNumber(number.phoneNumberId)).toBe("org-a");
    expect(await directory.organizationForAccount(number.businessAccountId)).toBe("org-a");
    expect(await directory.organizationForNumber("999")).toBeNull();
    expect(await directory.organizationForAccount("999")).toBeNull();
  });

  it("refuses a number another organization connected, and keeps it theirs", async () => {
    const directory = freshWhatsappDirectory();
    await directory.claim({ ...number, organizationId: "org-a" });

    expect(
      await directory.claim({
        phoneNumberId: number.phoneNumberId,
        businessAccountId: "555",
        organizationId: "org-b",
      }),
    ).toEqual({ ok: false, reason: "numberTaken" });
    expect(await directory.organizationForNumber(number.phoneNumberId)).toBe("org-a");
  });

  it("refuses an account another organization connected, so its template events have one owner", async () => {
    const directory = freshWhatsappDirectory();
    await directory.claim({ ...number, organizationId: "org-a" });

    expect(
      await directory.claim({
        phoneNumberId: "777",
        businessAccountId: number.businessAccountId,
        organizationId: "org-b",
      }),
    ).toEqual({ ok: false, reason: "accountTaken" });
    expect(await directory.organizationForNumber("777")).toBeNull();
  });

  it("lets an organization connect its own number again, and replaces its earlier number", async () => {
    const directory = freshWhatsappDirectory();
    await directory.claim({ ...number, organizationId: "org-a" });

    expect(await directory.claim({ ...number, organizationId: "org-a" })).toEqual({ ok: true });
    expect(
      await directory.claim({
        phoneNumberId: "888",
        businessAccountId: "444",
        organizationId: "org-a",
      }),
    ).toEqual({ ok: true });

    expect(await directory.organizationForNumber("888")).toBe("org-a");
    expect(await directory.organizationForNumber(number.phoneNumberId)).toBeNull();
    expect(await directory.organizationForAccount(number.businessAccountId)).toBeNull();
  });

  it("forgets a released number, which another organization may then connect", async () => {
    const directory = freshWhatsappDirectory();
    await directory.claim({ ...number, organizationId: "org-a" });

    await directory.release("org-a");

    expect(await directory.organizationForNumber(number.phoneNumberId)).toBeNull();
    expect(await directory.claim({ ...number, organizationId: "org-b" })).toEqual({ ok: true });
  });

  it("does not release another organization's number", async () => {
    const directory = freshWhatsappDirectory();
    await directory.claim({ ...number, organizationId: "org-a" });

    await directory.release("org-b");

    expect(await directory.organizationForNumber(number.phoneNumberId)).toBe("org-a");
  });

  it("checks a claim without making it", async () => {
    const directory = freshWhatsappDirectory();
    await directory.claim({ ...number, organizationId: "org-a" });

    expect(await directory.check({ ...number, organizationId: "org-b" })).toEqual({
      ok: false,
      reason: "numberTaken",
    });
    expect(
      await directory.check({
        phoneNumberId: "777",
        businessAccountId: "444",
        organizationId: "org-b",
      }),
    ).toEqual({ ok: true });
    expect(await directory.organizationForNumber("777")).toBeNull();
  });
});
