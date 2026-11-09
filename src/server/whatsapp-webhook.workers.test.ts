import { createHmac } from "node:crypto";

import { env } from "cloudflare:test";
import { describe, expect, it } from "vite-plus/test";

import {
  adminCaller,
  inStorage,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import { whatsappMessage, whatsappTemplate } from "#/organization/schema.ts";
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

/** A `messages` webhook call as Meta sends it, for the number `toPhoneNumberId`. */
function metaPayload(toPhoneNumberId = phoneNumberId) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: businessAccountId,
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
        name: "confirmacion_turno",
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
});
