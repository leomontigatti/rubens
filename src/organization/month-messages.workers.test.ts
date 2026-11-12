import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { WhatsappMessageStatus } from "#/lib/whatsapp-messages.ts";

import {
  addOffice,
  adminCaller,
  expectOk,
  fakeMeta,
  inStorage,
  metaBusinessAccountId,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import { conversation, whatsappMessage } from "#/organization/whatsapp-schema.ts";

// The WhatsApp messages Meta bills the organization for this month, as the
// WhatsApp settings show them (#294): the templates delivered, by category,
// and the other messages delivered, the service messages. The month is the
// organization's, in its first office's zone. Sending a message takes Meta
// and an approved template, so a test writes the outgoing rows as the
// sending code stores them, and Meta's statuses arrive through the webhook's method.

vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

const patientPhone = "+5493515551234";

let organization: OrganizationStub;

/** The month's messages as an admin reads them in the WhatsApp settings. */
async function monthMessages() {
  return expectOk(await organization.whatsappSettings(adminCaller)).messages;
}

/** An outgoing message of `type` sent at `sentAt`, with Meta's latest status on it. */
async function sent(type: "template" | "text", sentAt: number, status: WhatsappMessageStatus) {
  const whatsappId = `wamid.${crypto.randomUUID()}`;
  await inStorage(organization, (database) => {
    const found = database.select().from(conversation).get();
    const conversationId =
      found?.id ??
      database.insert(conversation).values({ phone: patientPhone }).returning().get().id;
    database
      .insert(whatsappMessage)
      .values({
        conversationId,
        whatsappId,
        direction: "outgoing",
        type,
        text: "Hola",
        payload: "{}",
        sentAt,
      })
      .run();
  });
  await organization.storeWhatsappEvents({
    messages: [],
    statuses: [{ whatsappId, status, at: sentAt + 1_000 }],
    templateStatuses: [],
  });
}

/** A patient's text received at `sentAt`. */
async function received(sentAt: number) {
  await organization.storeWhatsappEvents({
    messages: [
      {
        whatsappId: `wamid.${crypto.randomUUID()}`,
        from: patientPhone,
        sentAt,
        type: "text",
        text: "Hola, quería confirmar el turno",
        payload: "{}",
      },
    ],
    statuses: [],
    templateStatuses: [],
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  fakeMeta.reset();
  ({ organization } = await setUpTestOrganization());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the month's WhatsApp messages", () => {
  it("are none in a month with no message", async () => {
    vi.setSystemTime(new Date("2099-03-15T12:00:00Z"));
    await addOffice(organization, "Centro");
    await received(Date.parse("2099-03-14T12:00:00Z"));

    expect(await monthMessages()).toEqual({
      month: "2099-03",
      templates: { utility: 0, marketing: 0, authentication: 0 },
      serviceMessages: 0,
    });
  });

  it("count the month in the first office's zone, across its first midnight", async () => {
    // 00:30 of February 1st in Madrid, still January 31st in UTC and in Buenos Aires.
    vi.setSystemTime(new Date("2099-01-31T23:30:00Z"));
    await addOffice(organization, "Madrid", "Europe/Madrid");
    await addOffice(organization, "Córdoba");
    // 23:50 of January 31st in Madrid: last month.
    await sent("template", Date.parse("2099-01-31T22:50:00Z"), "read");
    await sent("text", Date.parse("2099-01-31T22:55:00Z"), "delivered");
    // 00:10 of February 1st in Madrid: this month.
    await sent("template", Date.parse("2099-01-31T23:10:00Z"), "delivered");
    await sent("text", Date.parse("2099-01-31T23:15:00Z"), "read");

    expect(await monthMessages()).toEqual({
      month: "2099-02",
      templates: { utility: 1, marketing: 0, authentication: 0 },
      serviceMessages: 1,
    });
  });

  it("count only what Meta delivered, and nothing the patients sent", async () => {
    vi.setSystemTime(new Date("2099-03-15T12:00:00Z"));
    await addOffice(organization, "Centro");
    const earlier = Date.parse("2099-03-10T12:00:00Z");
    await received(earlier);
    await sent("template", earlier, "delivered");
    await sent("template", earlier + 1, "read");
    await sent("template", earlier + 2, "sent");
    await sent("template", earlier + 3, "failed");
    await sent("text", earlier + 4, "delivered");
    await sent("text", earlier + 5, "failed");

    expect(await monthMessages()).toEqual({
      month: "2099-03",
      templates: { utility: 2, marketing: 0, authentication: 0 },
      serviceMessages: 1,
    });
  });
});

describe("the link to the billing in WhatsApp Manager", () => {
  it("names the business account the number sends from", async () => {
    expect(expectOk(await organization.whatsappSettings(adminCaller)).businessAccountId).toBe(
      metaBusinessAccountId,
    );
  });

  it("has no account while none is known", async () => {
    fakeMeta.settings = { ...fakeMeta.settings, WHATSAPP_BUSINESS_ACCOUNT_ID: undefined };

    expect(expectOk(await organization.whatsappSettings(adminCaller)).businessAccountId).toBeNull();
  });
});
