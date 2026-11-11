import { createHmac } from "node:crypto";

import { env } from "cloudflare:test";
import { describe, expect, it } from "vite-plus/test";

import {
  adminCaller,
  freshOrganization,
  inStorage,
  setUpTestOrganization,
  whatsappDirectory,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import {
  whatsappConnection,
  whatsappMessage,
  whatsappTemplate,
} from "#/organization/whatsapp-schema.ts";
import type { WorkerEnv } from "#/server/caller.ts";
import { handleWhatsappWebhook } from "#/server/whatsapp-webhook.ts";

const appSecret = "the-app-secret";
const verifyToken = "the-verify-token";
const phoneNumberId = "106540352242922";
const businessAccountId = "102290129340398";

/** The Worker's bindings, with the test number mapped to `organizationId`. */
function bindingsFor(organizationId: string): WorkerEnv {
  return {
    ...(env as unknown as WorkerEnv),
    META_APP_SECRET: appSecret,
    WHATSAPP_VERIFY_TOKEN: verifyToken,
    WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
    WHATSAPP_BUSINESS_ACCOUNT_ID: businessAccountId,
    WHATSAPP_ORGANIZATION_ID: organizationId,
  };
}

/** The Worker's bindings with no configured test number: each number found in the directory. */
function directoryBindings(): WorkerEnv {
  return {
    ...(env as unknown as WorkerEnv),
    META_APP_SECRET: appSecret,
    WHATSAPP_VERIFY_TOKEN: verifyToken,
  };
}

/** A number and account of their own, connected to `organizationId` in the directory. */
async function connectInDirectory(organizationId: string) {
  const digits = () => String(crypto.getRandomValues(new Uint32Array(1))[0]);
  const number = { phoneNumberId: digits(), businessAccountId: digits() };
  await whatsappDirectory().claim({ ...number, organizationId });
  return number;
}

/** A `messages` webhook call as Meta sends it, for the number `toPhoneNumberId`. */
function metaPayload(toPhoneNumberId = phoneNumberId, accountId = businessAccountId) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: accountId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550783881", phone_number_id: toPhoneNumberId },
              contacts: [{ profile: { name: "Laura" }, wa_id: "5493514440000" }],
              messages: [
                {
                  from: "5493514440000",
                  id: "wamid.HBgNNTQ5MzUxNDQ0MDAwMBUCABIYFjNFQjBDMEE",
                  timestamp: "4071240000",
                  type: "text",
                  text: { body: "Hola, quería confirmar el turno" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** A template status call as Meta sends it, for the business account `accountId`. */
function templateStatusPayload(templateId: number, accountId = businessAccountId) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: accountId,
        time: 4071240000,
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: "REJECTED",
              message_template_id: templateId,
              message_template_name: "confirmacion_turno_v1",
              message_template_language: "es_AR",
              reason: "INVALID_FORMAT",
            },
          },
        ],
      },
    ],
  };
}

function post(body: string, signature: string | null = sign(body)) {
  return new Request("https://underthing.test/api/whatsapp", {
    method: "POST",
    headers: signature ? { "x-hub-signature-256": signature } : {},
    body,
  });
}

function sign(body: string, secret = appSecret) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function handshake(token: string) {
  const query = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": token,
    "hub.challenge": "1158201444",
  });
  return new Request(`https://underthing.test/api/whatsapp?${query}`);
}

/** A template submitted with Meta's id `metaId`, pending review. */
function addPendingTemplate(organization: OrganizationStub, metaId: string) {
  return inStorage(organization, (database) =>
    database
      .insert(whatsappTemplate)
      .values({
        templateId: "turno_movido",
        version: 1,
        language: "es_AR",
        body: "Hola {{paciente}}, nos vemos.",
        metaId,
        status: "pending",
        submittedBy: "user-admin",
      })
      .run(),
  );
}

/** Each stored template version's status, as the WhatsApp settings show it. */
async function storedTemplateStatuses(organization: OrganizationStub) {
  const settings = await organization.whatsappSettings(adminCaller);
  if (!settings.ok) {
    throw new Error(`whatsappSettings refused: ${settings.reason}`);
  }
  return settings.templates.flatMap((template) =>
    template.versions.map(({ metaId, status, rejectionReason }) => ({
      metaId,
      status,
      rejectionReason,
    })),
  );
}

function storedMessages(organization: OrganizationStub) {
  return inStorage(organization, (database) =>
    database
      .select({ whatsappId: whatsappMessage.whatsappId, text: whatsappMessage.text })
      .from(whatsappMessage)
      .all(),
  );
}

/** A call with one change for the business account `accountId`, as Meta sends it. */
function accountChange(field: string, value: unknown, accountId = businessAccountId) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: accountId, time: 4071240000, changes: [{ field, value }] }],
  });
}

async function notificationsOf(organization: OrganizationStub) {
  const listed = await organization.listNotifications(adminCaller);
  if (!listed.ok) {
    throw new Error(`listNotifications refused: ${listed.reason}`);
  }
  return listed.notifications;
}

describe("Meta's WhatsApp webhook", () => {
  it("answers the verification handshake with the challenge, only for the verify token", async () => {
    const bindings = bindingsFor("unused");

    const right = await handleWhatsappWebhook(handshake(verifyToken), bindings);
    const wrong = await handleWhatsappWebhook(handshake("not-the-token"), bindings);

    expect([right.status, await right.text()]).toEqual([200, "1158201444"]);
    expect(wrong.status).toBe(403);
  });

  it("stores a signed call's messages in the organization the phone number id maps to", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    const body = JSON.stringify(metaPayload());

    const response = await handleWhatsappWebhook(post(body), bindingsFor(organizationId));

    expect(response.status).toBe(200);
    expect(await storedMessages(organization)).toEqual([
      {
        whatsappId: "wamid.HBgNNTQ5MzUxNDQ0MDAwMBUCABIYFjNFQjBDMEE",
        text: "Hola, quería confirmar el turno",
      },
    ]);
  });

  it("stores a template status event for the configured business account, and drops another account's", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    await addPendingTemplate(organization, "594425479261596");
    const ours = JSON.stringify(templateStatusPayload(594425479261596));
    const theirs = JSON.stringify(templateStatusPayload(594425479261596, "999999999999999"));
    const bindings = bindingsFor(organizationId);

    const dropped = await handleWhatsappWebhook(post(theirs), bindings);
    const afterTheirs = await storedTemplateStatuses(organization);
    const stored = await handleWhatsappWebhook(post(ours), bindings);

    expect([dropped.status, stored.status]).toEqual([200, 200]);
    expect(afterTheirs).toMatchObject([{ status: "pending" }]);
    expect(await storedTemplateStatuses(organization)).toEqual([
      { metaId: "594425479261596", status: "rejected", rejectionReason: "INVALID_FORMAT" },
    ]);
  });

  it("reads a template id past JavaScript's safe integers digit for digit", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    await addPendingTemplate(organization, "1234567890123456789");
    // Meta sends the id as a JSON number, which `JSON.parse` would round.
    const body = JSON.stringify(templateStatusPayload(0)).replace(
      '"message_template_id":0',
      '"message_template_id":1234567890123456789',
    );

    await handleWhatsappWebhook(post(body), bindingsFor(organizationId));

    expect(await storedTemplateStatuses(organization)).toMatchObject([
      { metaId: "1234567890123456789", status: "rejected" },
    ]);
  });

  it("refuses a call with a bad or missing signature with 401, reaching no object", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    const body = JSON.stringify(metaPayload());
    const bindings = bindingsFor(organizationId);

    const responses = [
      await handleWhatsappWebhook(post(body, sign(body, "another-secret")), bindings),
      await handleWhatsappWebhook(post(body, null), bindings),
    ];

    expect(responses.map((response) => response.status)).toEqual([401, 401]);
    expect(await storedMessages(organization)).toEqual([]);
  });

  it("answers 200 and drops a call for a phone number id no organization has", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    const body = JSON.stringify(metaPayload("999999999999999"));

    const response = await handleWhatsappWebhook(post(body), bindingsFor(organizationId));

    expect(response.status).toBe(200);
    expect(await storedMessages(organization)).toEqual([]);
  });

  it("serves nothing while the app secret or the verify token is unset", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    const body = JSON.stringify(metaPayload());
    const unset = { ...bindingsFor(organizationId), META_APP_SECRET: undefined };

    // Signed with an empty key, the one an unset secret would leave.
    const call = await handleWhatsappWebhook(post(body, sign(body, "")), unset);
    const check = await handleWhatsappWebhook(handshake(""), {
      ...bindingsFor(organizationId),
      WHATSAPP_VERIFY_TOKEN: undefined,
    });

    expect([call.status, check.status]).toEqual([404, 404]);
    expect(await storedMessages(organization)).toEqual([]);
  });

  it("stores a call's messages in the organization the directory maps the number to", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    const number = await connectInDirectory(organizationId);
    const body = JSON.stringify(metaPayload(number.phoneNumberId, number.businessAccountId));

    const response = await handleWhatsappWebhook(post(body), directoryBindings());

    expect(response.status).toBe(200);
    expect(await storedMessages(organization)).toMatchObject([
      { text: "Hola, quería confirmar el turno" },
    ]);
  });

  it("stores a template status event in the organization the directory maps the account to", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    const number = await connectInDirectory(organizationId);
    await addPendingTemplate(organization, "594425479261597");
    const body = JSON.stringify(templateStatusPayload(594425479261597, number.businessAccountId));

    await handleWhatsappWebhook(post(body), directoryBindings());

    expect(await storedTemplateStatuses(organization)).toMatchObject([{ status: "rejected" }]);
  });

  it("stores each change of one call in its own number's organization, and nowhere else", async () => {
    const first = await setUpTestOrganization();
    const second = await setUpTestOrganization();
    const firstNumber = await connectInDirectory(first.organizationId);
    const secondNumber = await connectInDirectory(second.organizationId);
    const forFirst = metaPayload(firstNumber.phoneNumberId, firstNumber.businessAccountId);
    const forSecond = metaPayload(secondNumber.phoneNumberId, secondNumber.businessAccountId);
    forSecond.entry[0]!.changes[0]!.value.messages[0]!.id = "wamid.second";
    forSecond.entry[0]!.changes[0]!.value.messages[0]!.text.body = "Soy del segundo";
    const body = JSON.stringify({ ...forFirst, entry: [...forFirst.entry, ...forSecond.entry] });

    await handleWhatsappWebhook(post(body), directoryBindings());

    expect(await storedMessages(first.organization)).toMatchObject([
      { text: "Hola, quería confirmar el turno" },
    ]);
    expect(await storedMessages(second.organization)).toEqual([
      { whatsappId: "wamid.second", text: "Soy del segundo" },
    ]);
  });

  it("holds the number until the expiration of Meta's restriction on business-started messages", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    const restriction = accountChange("account_update", {
      event: "ACCOUNT_RESTRICTION",
      restriction_info: [
        { restriction_type: "RESTRICTED_ADD_PHONE_NUMBER_ACTION", expiration: 4071340000 },
        { restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING", expiration: 4071330000 },
      ],
    });

    const response = await handleWhatsappWebhook(post(restriction), bindingsFor(organizationId));

    expect(response.status).toBe(200);
    expect(await notificationsOf(organization)).toEqual([
      expect.objectContaining({ kind: "numberRestricted", until: 4071330000 * 1000 }),
    ]);
  });

  it("reads a restriction that no longer limits business-started messages as lifted", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    const bindings = bindingsFor(organizationId);
    const restricted = accountChange("account_update", {
      event: "ACCOUNT_RESTRICTION",
      restriction_info: [{ restriction_type: "RESTRICTED_BIZ_INITIATED_MESSAGING" }],
    });
    const lifted = accountChange("account_update", {
      event: "ACCOUNT_RESTRICTION",
      restriction_info: [{ restriction_type: "RESTRICTED_ADD_PHONE_NUMBER_ACTION" }],
    });

    await handleWhatsappWebhook(post(restricted), bindings);
    const held = await organization.whatsappSettings(adminCaller);
    await handleWhatsappWebhook(post(lifted), bindings);
    const free = await organization.whatsappSettings(adminCaller);

    expect(held).toMatchObject({ hold: { reason: "restricted", until: null } });
    expect(free).toMatchObject({ hold: null });
  });

  it("holds the number while Meta disables the account, until it reinstates it", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    const bindings = bindingsFor(organizationId);
    const ban = (state: string) =>
      accountChange("account_update", {
        event: "DISABLED_UPDATE",
        ban_info: { waba_ban_state: state, waba_ban_date: "2099-01-01" },
      });

    await handleWhatsappWebhook(post(ban("DISABLE")), bindings);
    const held = await organization.whatsappSettings(adminCaller);
    await handleWhatsappWebhook(post(ban("REINSTATE")), bindings);

    expect(held).toMatchObject({ hold: { reason: "disabled" } });
    expect(await organization.whatsappSettings(adminCaller)).toMatchObject({ hold: null });
    expect(await notificationsOf(organization)).toEqual([
      expect.objectContaining({ kind: "numberDisabled" }),
    ]);
  });

  it("stores a template Meta moved to marketing, and ignores a warning of a move still to come", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    await addPendingTemplate(organization, "594425479261598");
    const bindings = bindingsFor(organizationId);
    const template = {
      message_template_id: 594425479261598,
      message_template_name: "confirmacion_turno_v1",
      message_template_language: "es_AR",
    };
    const upcoming = accountChange("template_category_update", {
      ...template,
      new_category: "UTILITY",
      correct_category: "MARKETING",
      category_update_timestamp: 4071330000,
    });
    const moved = accountChange("template_category_update", {
      ...template,
      previous_category: "UTILITY",
      new_category: "MARKETING",
    });

    await handleWhatsappWebhook(post(upcoming), bindings);
    const before = await notificationsOf(organization);
    await handleWhatsappWebhook(post(moved), bindings);

    expect(before).toEqual([]);
    expect(await notificationsOf(organization)).toEqual([
      expect.objectContaining({ kind: "templateRecategorized", detail: "MARKETING" }),
    ]);
  });

  it("reads the number's new messaging limit from the business's daily limit", async () => {
    const { organizationId, organization } = await setUpTestOrganization();
    await inStorage(organization, (database) =>
      database
        .insert(whatsappConnection)
        .values({
          id: 1,
          businessAccountId,
          phoneNumberId,
          displayNumber: "+1 555 078 3881",
          messagingLimit: "TIER_2K",
          state: "disconnected",
          connectedBy: adminCaller.userId,
        })
        .run(),
    );
    const lowered = accountChange("phone_number_quality_update", {
      display_phone_number: "15550783881",
      event: "DOWNGRADE",
      max_daily_conversations_per_business: "TIER_250",
    });

    await handleWhatsappWebhook(post(lowered), bindingsFor(organizationId));

    expect(await organization.whatsappSettings(adminCaller)).toMatchObject({
      connection: { messagingLimit: "TIER_250" },
    });
  });

  it("answers 500, so Meta retries, when the number maps to an organization never set up", async () => {
    const { organizationId, organization } = freshOrganization();
    const number = await connectInDirectory(organizationId);
    const body = JSON.stringify(metaPayload(number.phoneNumberId, number.businessAccountId));

    const response = await handleWhatsappWebhook(post(body), directoryBindings());

    expect(response.status).toBe(500);
    expect(await storedMessages(organization)).toEqual([]);
  });
});
