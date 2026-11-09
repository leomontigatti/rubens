import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Role } from "#/lib/access.ts";

import {
  addMember,
  addRefusedAdmin,
  adminCaller,
  expectOk,
  fakeMeta,
  inStorage,
  metaAccessToken,
  metaPhoneNumberId,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import { auditLog } from "#/organization/schema.ts";

// The object reaches Meta only through its Graph API client, whose HTTP calls
// go to the fake Meta: each test reads the requests it received.
vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: () => actual.whatsappCloudFor(fakeMeta.settings, fakeMeta.fetch),
  };
});

const helloWorld = {
  to: "+54 9 11 5555-0000",
  templateName: "hello_world",
  languageCode: "en_US",
};

let organization: OrganizationStub;

/** The audit log's entries about WhatsApp messages, oldest first. */
function messageAuditEntries() {
  return inStorage(organization, (database) =>
    database
      .select({ userId: auditLog.userId, action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.entityType, "whatsappMessage"))
      .orderBy(sql`rowid`)
      .all(),
  );
}

beforeEach(async () => {
  fakeMeta.reset();
  ({ organization } = await setUpTestOrganization());
});

describe("sending a template", () => {
  it("sends the template to the recipient through the configured number, and returns Meta's message id", async () => {
    const sent = expectOk(await organization.sendWhatsappTemplate(adminCaller, helloWorld));

    expect(sent.messageId).toBe("wamid.test-message");
    expect(fakeMeta.requests).toEqual([
      {
        method: "POST",
        url: `https://graph.facebook.com/v26.0/${metaPhoneNumberId}/messages`,
        authorization: expect.stringMatching(/^Bearer /),
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "5491155550000",
          type: "template",
          template: { name: "hello_world", language: { code: "en_US" } },
        },
      },
    ]);
  });

  it.each<[string, Role[]]>([
    ["receptionist", ["receptionist"]],
    ["practitioner", ["practitioner"]],
  ])("refuses a %s, and sends nothing", async (_name, roles) => {
    const member = await addMember(organization, roles);

    expect(await organization.sendWhatsappTemplate(member, helloWorld)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(fakeMeta.requests).toEqual([]);
  });

  it("refuses an unknown caller and an admin who must still change their password, and sends nothing", async () => {
    const stranger = { userId: "user-stranger" };
    const admin = await addRefusedAdmin(organization, "mustChangePassword");

    expect(await organization.sendWhatsappTemplate(stranger, helloWorld)).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(await organization.sendWhatsappTemplate(admin, helloWorld)).toEqual({
      ok: false,
      reason: "mustChangePassword",
    });
    expect(fakeMeta.requests).toEqual([]);
  });

  it("refuses a number that is not a phone before calling Meta", async () => {
    const result = await organization.sendWhatsappTemplate(adminCaller, {
      ...helloWorld,
      to: "+54 12",
    });

    expect(result).toEqual({ ok: false, reason: "invalidPhone" });
    expect(fakeMeta.requests).toEqual([]);
  });

  it("answers Meta's refusal with Meta's message", async () => {
    fakeMeta.answerWith(400, {
      error: {
        message: "(#131030) Recipient phone number not in allowed list",
        type: "OAuthException",
        code: 131030,
        fbtrace_id: "trace",
      },
    });

    expect(await organization.sendWhatsappTemplate(adminCaller, helloWorld)).toEqual({
      ok: false,
      reason: "metaRefused",
      metaError: { code: 131030, message: "(#131030) Recipient phone number not in allowed list" },
    });
  });

  it.each([
    ["WHATSAPP_ACCESS_TOKEN", "missingAccessToken"],
    ["WHATSAPP_PHONE_NUMBER_ID", "missingPhoneNumberId"],
  ] as const)(
    "with %s unset, refuses with that reason and sends nothing",
    async (setting, reason) => {
      delete fakeMeta.settings[setting];

      expect(await organization.sendWhatsappTemplate(adminCaller, helloWorld)).toEqual({
        ok: false,
        reason,
      });
      expect(fakeMeta.requests).toEqual([]);
    },
  );

  it("records each send in the audit log, with the number masked and Meta's answer", async () => {
    expectOk(await organization.sendWhatsappTemplate(adminCaller, helloWorld));
    fakeMeta.answerWith(400, { error: { message: "Recipient not allowed", code: 131030 } });
    await organization.sendWhatsappTemplate(adminCaller, helloWorld);

    const sent = { to: "+•••••••••0000", templateName: "hello_world", languageCode: "en_US" };
    expect(await messageAuditEntries()).toEqual([
      {
        userId: adminCaller.userId,
        action: "create",
        after: { ...sent, messageId: "wamid.test-message", metaErrorCode: null },
      },
      {
        userId: adminCaller.userId,
        action: "create",
        after: { ...sent, messageId: null, metaErrorCode: 131030 },
      },
    ]);
  });

  it("returns and records nothing that holds the access token", async () => {
    const sent = await organization.sendWhatsappTemplate(adminCaller, helloWorld);
    fakeMeta.answerWith(401, { error: { message: "Error validating access token", code: 190 } });
    const refused = await organization.sendWhatsappTemplate(adminCaller, helloWorld);

    expect(fakeMeta.requests.map((request) => request.authorization)).toEqual([
      `Bearer ${metaAccessToken}`,
      `Bearer ${metaAccessToken}`,
    ]);
    const shown = JSON.stringify([sent, refused, await messageAuditEntries()]);
    expect(shown).not.toContain(metaAccessToken);
  });
});

describe("the WhatsApp settings", () => {
  it("tell an admin which setting keeps a send from being made", async () => {
    expect(await organization.whatsappSettings(adminCaller)).toMatchObject({
      ok: true,
      missing: null,
    });

    delete fakeMeta.settings.WHATSAPP_PHONE_NUMBER_ID;

    expect(await organization.whatsappSettings(adminCaller)).toMatchObject({
      ok: true,
      missing: "missingPhoneNumberId",
    });
  });

  it("are refused to anyone but a signed-in admin", async () => {
    const callers = [
      await addMember(organization, ["receptionist"]),
      await addMember(organization, ["practitioner"]),
      { userId: "user-stranger" },
      await addRefusedAdmin(organization, "mustChangePassword"),
    ];

    const answers = await Promise.all(
      callers.map(async (caller) => {
        const answer = await organization.whatsappSettings(caller);
        return answer.ok ? "shown" : answer.reason;
      }),
    );
    expect(answers).toEqual(["forbidden", "forbidden", "unauthenticated", "mustChangePassword"]);
  });
});
