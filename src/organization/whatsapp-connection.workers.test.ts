import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Role } from "#/lib/access.ts";

import {
  addMember,
  addRefusedAdmin,
  adminCaller,
  expectOk,
  fakeMeta,
  inStorage,
  metaBusinessToken,
  setUpTestOrganization,
  whatsappDirectory,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import { organizationCipher } from "#/organization/encryption.ts";
import { metaSignupFor } from "#/organization/graph-api.ts";
import { auditLog } from "#/organization/schema.ts";
import { whatsappConnection } from "#/organization/whatsapp-schema.ts";
import { WhatsappNumber } from "#/organization/whatsapp-connection.ts";

// Embedded Signup's completion, through the object, with Meta faked at its
// HTTP boundary and the Worker's real WhatsApp directory.
vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

let organization: OrganizationStub;
let organizationId: string;

/** What the signup popup returns for the fake Meta's number. */
function completion() {
  const { phoneNumberId, businessAccountId } = fakeMeta.signupNumber;
  return { code: "signup-code", phoneNumberId, businessAccountId };
}

const confirmation = {
  templateName: "confirmacion_turno",
  body: "Hola {{paciente}}, tu turno con {{profesional}} es el {{fecha}} a las {{hora}}. Consultorios Prueba",
} as const;

/** A call to Meta with the number's token: an admin submitting a template. */
function callMeta() {
  return organization.submitWhatsappTemplate(adminCaller, confirmation);
}

async function connection() {
  return expectOk(await organization.whatsappSettings(adminCaller)).connection;
}

function storedConnection() {
  return inStorage(organization, (database) => database.select().from(whatsappConnection).get());
}

beforeEach(async () => {
  fakeMeta.reset();
  // A real practice: no configured test number stands in for its own.
  fakeMeta.settings = {};
  ({ organization, organizationId } = await setUpTestOrganization());
});

describe("connecting the organization's number", () => {
  it("stores the connected number with Meta's messaging limit, and the token only sealed", async () => {
    expect(await organization.connectWhatsapp(adminCaller, completion())).toEqual({ ok: true });

    expect(await connection()).toMatchObject({
      displayNumber: "+54 9 351 555-0100",
      messagingLimit: "TIER_250",
      state: "connected",
      failureReason: null,
    });
    const stored = await storedConnection();
    expect(stored).toMatchObject({
      phoneNumberId: fakeMeta.signupNumber.phoneNumberId,
      businessAccountId: fakeMeta.signupNumber.businessAccountId,
    });
    expect(stored?.accessToken).toEqual(expect.any(String));
    expect(JSON.stringify(stored)).not.toContain(metaBusinessToken);
    expect(JSON.stringify(await organization.whatsappSettings(adminCaller))).not.toContain(
      metaBusinessToken,
    );
  });

  it("exchanges the code, registers the number and subscribes the app, with the business token", async () => {
    const { phoneNumberId, businessAccountId } = fakeMeta.signupNumber;

    expectOk(await organization.connectWhatsapp(adminCaller, completion()));

    const exchange = new URL(fakeMeta.requests[0]!.url);
    expect(exchange.pathname).toMatch(/\/oauth\/access_token$/);
    expect(Object.fromEntries(exchange.searchParams)).toEqual({
      client_id: "1234567890",
      client_secret: "test-app-secret-never-shown",
      code: "signup-code",
    });
    const writes = fakeMeta.requests.filter((request) => request.method === "POST");
    expect(writes).toEqual([
      {
        method: "POST",
        url: `https://graph.facebook.com/v26.0/${phoneNumberId}/register`,
        authorization: `Bearer ${metaBusinessToken}`,
        body: { messaging_product: "whatsapp", pin: expect.stringMatching(/^\d{6}$/) },
      },
      {
        method: "POST",
        url: `https://graph.facebook.com/v26.0/${businessAccountId}/subscribed_apps`,
        authorization: `Bearer ${metaBusinessToken}`,
        body: {},
      },
    ]);
  });

  it("maps the number and its account to the organization in the directory", async () => {
    expectOk(await organization.connectWhatsapp(adminCaller, completion()));

    const directory = whatsappDirectory();
    expect(await directory.organizationForNumber(fakeMeta.signupNumber.phoneNumberId)).toBe(
      organizationId,
    );
    expect(await directory.organizationForAccount(fakeMeta.signupNumber.businessAccountId)).toBe(
      organizationId,
    );
  });

  it("calls Meta for the connected number's account with its token, which was opened from the sealed copy", async () => {
    expectOk(await organization.connectWhatsapp(adminCaller, completion()));
    fakeMeta.requests = [];
    fakeMeta.answerWith(200, { id: "594425479261596", status: "PENDING", category: "UTILITY" });

    expectOk(await callMeta());

    expect(fakeMeta.requests.filter((request) => request.method === "POST")).toMatchObject([
      {
        url: `https://graph.facebook.com/v26.0/${fakeMeta.signupNumber.businessAccountId}/message_templates`,
        authorization: `Bearer ${metaBusinessToken}`,
      },
    ]);
  });

  it("refuses a number another organization connected, and stores nothing", async () => {
    const other = await setUpTestOrganization();
    expectOk(await other.organization.connectWhatsapp(adminCaller, completion()));
    fakeMeta.requests = [];

    expect(await organization.connectWhatsapp(adminCaller, completion())).toEqual({
      ok: false,
      reason: "numberTaken",
    });

    expect(await connection()).toBeNull();
    expect(fakeMeta.requests.filter((request) => request.method === "POST")).toEqual([]);
    expect(
      await whatsappDirectory().organizationForNumber(fakeMeta.signupNumber.phoneNumberId),
    ).toBe(other.organizationId);
  });

  it("refuses a number the account Meta signed up does not have", async () => {
    expect(
      await organization.connectWhatsapp(adminCaller, { ...completion(), phoneNumberId: "42" }),
    ).toEqual({ ok: false, reason: "numberNotInAccount" });

    expect(await connection()).toBeNull();
    expect(await whatsappDirectory().organizationForNumber("42")).toBeNull();
  });

  it.each(["exchange", "register", "subscribe"] as const)(
    "saves nothing when Meta refuses the %s, and leaves the number free",
    async (step) => {
      fakeMeta.signupRefusals[step] = {
        status: 400,
        body: { error: { message: "Meta says no", code: 100 } },
      };

      expect(await organization.connectWhatsapp(adminCaller, completion())).toEqual({
        ok: false,
        reason: "metaRefused",
        metaError: { code: 100, message: "Meta says no" },
      });

      expect(await connection()).toBeNull();
      expect(
        await whatsappDirectory().organizationForNumber(fakeMeta.signupNumber.phoneNumberId),
      ).toBeNull();
    },
  );

  it("keeps the number it had connected when connecting another fails", async () => {
    expectOk(await organization.connectWhatsapp(adminCaller, completion()));
    const first = { ...fakeMeta.signupNumber };
    fakeMeta.signupNumber = { ...first, phoneNumberId: "777", businessAccountId: "888" };
    fakeMeta.signupRefusals.register = {
      status: 400,
      body: { error: { message: "Meta says no", code: 100 } },
    };

    expect(await organization.connectWhatsapp(adminCaller, completion())).toMatchObject({
      reason: "metaRefused",
    });

    const directory = whatsappDirectory();
    expect(await directory.organizationForNumber(first.phoneNumberId)).toBe(organizationId);
    expect(await directory.organizationForNumber("777")).toBeNull();
    expect(await connection()).toMatchObject({ state: "connected" });
  });

  it("refuses when the Worker misses a signup setting", async () => {
    delete fakeMeta.signupSettings.WHATSAPP_SIGNUP_CONFIG_ID;

    expect(expectOk(await organization.whatsappSettings(adminCaller)).signup).toBeNull();
    expect(await organization.connectWhatsapp(adminCaller, completion())).toEqual({
      ok: false,
      reason: "signupNotConfigured",
    });
    expect(fakeMeta.requests).toEqual([]);
  });

  it("refuses an input the popup could not have sent, and calls nobody", async () => {
    expect(
      await organization.connectWhatsapp(adminCaller, { ...completion(), phoneNumberId: "../me" }),
    ).toEqual({ ok: false, reason: "invalidInput" });
    expect(fakeMeta.requests).toEqual([]);
  });

  it("is audited without its token", async () => {
    expectOk(await organization.connectWhatsapp(adminCaller, completion()));

    const entries = await inStorage(organization, (database) =>
      database
        .select({ userId: auditLog.userId, action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.entityType, "whatsappConnection"))
        .all(),
    );
    expect(entries).toEqual([
      {
        userId: adminCaller.userId,
        action: "create",
        after: {
          phoneNumberId: fakeMeta.signupNumber.phoneNumberId,
          businessAccountId: fakeMeta.signupNumber.businessAccountId,
          state: "connected",
        },
      },
    ]);
  });
});

describe("who may use the connection", () => {
  it.each<[string, Role[]]>([
    ["receptionist", ["receptionist"]],
    ["practitioner", ["practitioner"]],
  ])("refuses a %s to connect, disconnect or read it", async (_name, roles) => {
    const member = await addMember(organization, roles);

    expect(await organization.connectWhatsapp(member, completion())).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await organization.disconnectWhatsapp(member)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await organization.whatsappSettings(member)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(fakeMeta.requests).toEqual([]);
  });

  it.each([
    ["deactivated", "unauthenticated"],
    ["mustChangePassword", "mustChangePassword"],
  ] as const)("refuses an admin who is %s", async (state, refusal) => {
    const admin = await addRefusedAdmin(organization, state);

    expectOk(await organization.connectWhatsapp(adminCaller, completion()));

    expect(await organization.connectWhatsapp(admin, completion())).toEqual({
      ok: false,
      reason: refusal,
    });
    expect(await organization.disconnectWhatsapp(admin)).toEqual({ ok: false, reason: refusal });
    expect(await connection()).toMatchObject({ state: "connected" });
  });

  it("refuses a caller who is not a member", async () => {
    const stranger = { userId: "user-unknown" };

    expect(await organization.connectWhatsapp(stranger, completion())).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(await organization.disconnectWhatsapp(stranger)).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(fakeMeta.requests).toEqual([]);
  });
});

describe("a connection Meta no longer accepts", () => {
  beforeEach(async () => {
    expectOk(await organization.connectWhatsapp(adminCaller, completion()));
  });

  it("shows as failed with Meta's reason once Meta refuses its token, and calls Meta no more", async () => {
    fakeMeta.answerNextWith(401, {
      error: { message: "Error validating access token: the user has revoked access", code: 190 },
    });

    expect(await callMeta()).toMatchObject({ reason: "metaRefused" });

    const settings = expectOk(await organization.whatsappSettings(adminCaller));
    expect(settings.connection).toMatchObject({
      state: "failed",
      failureReason: "Error validating access token: the user has revoked access",
    });
    expect(settings.templateMissing).toBe("connectionFailed");
    expect(await callMeta()).toEqual({ ok: false, reason: "connectionFailed" });
  });

  it("stays connected when Meta refuses for another reason", async () => {
    fakeMeta.answerNextWith(400, { error: { message: "Recipient not allowed", code: 131030 } });

    await callMeta();

    expect(await connection()).toMatchObject({ state: "connected" });
  });
});

describe("disconnecting the number", () => {
  beforeEach(async () => {
    expectOk(await organization.connectWhatsapp(adminCaller, completion()));
  });

  it("drops the token, frees the number in the directory and stops sending", async () => {
    expect(await organization.disconnectWhatsapp(adminCaller)).toEqual({ ok: true });

    const settings = expectOk(await organization.whatsappSettings(adminCaller));
    expect(settings.connection).toMatchObject({ state: "disconnected" });
    expect(settings.templateMissing).toBe("connectionFailed");
    expect((await storedConnection())?.accessToken).toBeNull();
    expect(
      await whatsappDirectory().organizationForNumber(fakeMeta.signupNumber.phoneNumberId),
    ).toBeNull();
  });

  it("connects again through signup afterwards", async () => {
    expectOk(await organization.disconnectWhatsapp(adminCaller));

    expect(await organization.connectWhatsapp(adminCaller, completion())).toEqual({ ok: true });

    expect(await connection()).toMatchObject({ state: "connected" });
  });

  it("refuses when no number is connected", async () => {
    expectOk(await organization.disconnectWhatsapp(adminCaller));

    expect(await organization.disconnectWhatsapp(adminCaller)).toEqual({
      ok: false,
      reason: "notConnected",
    });
  });
});

describe("connecting again", () => {
  const refused = { status: 400, body: { error: { message: "Meta says no", code: 100 } } };

  beforeEach(async () => {
    expectOk(await organization.connectWhatsapp(adminCaller, completion()));
  });

  /** The PIN each registration of the number sent, in order. */
  function registeredPins() {
    return fakeMeta.requests
      .filter((request) => request.url.endsWith("/register"))
      .map((request) => (request.body as { pin: string }).pin);
  }

  it("registers the same number again with the PIN it was first registered with", async () => {
    expectOk(await organization.disconnectWhatsapp(adminCaller));

    expectOk(await organization.connectWhatsapp(adminCaller, completion()));

    const [first, second] = registeredPins();
    expect(second).toBe(first);
  });

  it("keeps the number in the directory when reconnecting a failed connection is refused", async () => {
    fakeMeta.answerNextWith(401, { error: { message: "Token expired", code: 190 } });
    await callMeta();
    fakeMeta.signupRefusals.register = refused;

    expect(await organization.connectWhatsapp(adminCaller, completion())).toMatchObject({
      reason: "metaRefused",
    });

    expect(
      await whatsappDirectory().organizationForNumber(fakeMeta.signupNumber.phoneNumberId),
    ).toBe(organizationId);
    expect(await connection()).toMatchObject({ state: "failed" });
  });

  it("refuses a second change while one is still waiting on Meta", async () => {
    const release = fakeMeta.holdNext();
    const first = organization.connectWhatsapp(adminCaller, completion());
    await fakeMeta.received(fakeMeta.requests.length + 1);

    expect(await organization.disconnectWhatsapp(adminCaller)).toEqual({
      ok: false,
      reason: "alreadyChanging",
    });
    expect(await organization.connectWhatsapp(adminCaller, completion())).toEqual({
      ok: false,
      reason: "alreadyChanging",
    });
    release();
    expect(await first).toEqual({ ok: true });
  });

  it("is not failed by a late refusal of the token it replaced", async () => {
    // A version waiting on Meta's review, whose status is then read in one call.
    fakeMeta.answerNextWith(200, { id: "594425479261596", status: "PENDING", category: "UTILITY" });
    expectOk(await callMeta());
    fakeMeta.requests = [];
    const release = fakeMeta.holdNext();
    fakeMeta.answerNextWith(401, { error: { message: "Token expired", code: 190 } });
    const lateCall = organization.refreshWhatsappTemplates(adminCaller);
    await fakeMeta.received(1);
    fakeMeta.businessToken = "a-newer-business-token";
    expectOk(await organization.connectWhatsapp(adminCaller, completion()));

    release();
    await lateCall;

    expect(await connection()).toMatchObject({ state: "connected" });
  });

  it("maps the number in the directory before Meta starts sending its events", async () => {
    fakeMeta.signupNumber = {
      ...fakeMeta.signupNumber,
      phoneNumberId: "555",
      businessAccountId: "666",
    };
    const release = fakeMeta.holdSignupStep("subscribe");
    const before = fakeMeta.requests.length;
    const connecting = organization.connectWhatsapp(adminCaller, completion());
    // Exchange, the account's numbers, the number, register: subscribing is the fifth.
    await fakeMeta.received(before + 5);

    expect(await whatsappDirectory().organizationForNumber("555")).toBe(organizationId);
    release();
    expect(await connecting).toEqual({ ok: true });
  });

  /** What the object does when it starts again with the Worker's key set to `key`. */
  function restartWithKey(key: string | undefined) {
    return inStorage(organization, async (database) => {
      const restarted = new WhatsappNumber(database, {
        signup: metaSignupFor({}),
        directory: whatsappDirectory(),
        cipher: (id) => organizationCipher(key, id),
      });
      await restarted.open();
      return restarted.settings();
    });
  }

  it("shows as failed, to be connected again, when the Worker's key no longer opens its token", async () => {
    await restartWithKey(btoa("o".repeat(32)));

    const settings = expectOk(await organization.whatsappSettings(adminCaller));
    expect(settings.connection).toMatchObject({ state: "failed", failureReason: null });
    expect(settings.templateMissing).toBe("connectionFailed");
  });

  it.each([
    ["missing", undefined],
    ["too short to be a key", btoa("short")],
  ])("keeps the connection and its token when the Worker's key is %s", async (_name, key) => {
    const restarted = await restartWithKey(key);

    expect(await connection()).toMatchObject({ state: "connected" });
    expect((await storedConnection())?.accessToken).toEqual(expect.any(String));
    // The Worker's setting is missing, not the connection failed: connecting again would not help.
    expect(restarted).toMatchObject({ connectionFailed: false, WHATSAPP_ACCESS_TOKEN: undefined });
  });
});
