import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import type { IncomingWhatsappMessage } from "#/lib/whatsapp-messages.ts";

import {
  addMember,
  expectOk,
  inStorage,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import {
  conversation,
  conversationPatient,
  whatsappMessage,
} from "#/organization/whatsapp-schema.ts";

/** A text from `from` (E.164), as the webhook hands it over. */
function incoming(from: string, whatsappId = `wamid.${crypto.randomUUID()}`) {
  return {
    whatsappId,
    from,
    sentAt: Date.UTC(2099, 0, 5, 12),
    type: "text",
    text: "Hola, quería confirmar el turno",
    payload: "{}",
  } satisfies IncomingWhatsappMessage;
}

/** Every stored message, with the phone of its conversation and the patients it is linked to. */
function storedMessages(organization: OrganizationStub) {
  return inStorage(organization, (database) =>
    database
      .select({
        whatsappId: whatsappMessage.whatsappId,
        phone: conversation.phone,
        conversationId: conversation.id,
        status: whatsappMessage.status,
      })
      .from(whatsappMessage)
      .innerJoin(conversation, eq(conversation.id, whatsappMessage.conversationId))
      .all(),
  );
}

function linkedPatients(organization: OrganizationStub, conversationId: string) {
  return inStorage(organization, (database) =>
    database
      .select({ patientId: conversationPatient.patientId })
      .from(conversationPatient)
      .where(eq(conversationPatient.conversationId, conversationId))
      .all()
      .map((row) => row.patientId)
      .sort(),
  );
}

/** A patient registered with `phone`, by a receptionist; returns their id. */
async function registered(organization: OrganizationStub, firstName: string, phone: string) {
  const receptionist = await addMember(organization, ["receptionist"]);
  const result = expectOk(
    await organization.registerPatient(receptionist, { firstName, lastName: "Pérez", phone }),
  );
  return { receptionist, patientId: result.patient.id };
}

/**
 * An outgoing message in a conversation with `phone`, as the sending code
 * will store it: no method sends yet, so the test writes the row.
 */
function sentTo(organization: OrganizationStub, phone: string) {
  const whatsappId = `wamid.${crypto.randomUUID()}`;
  return inStorage(organization, (database) => {
    const { id } = database.insert(conversation).values({ phone }).returning().get();
    database
      .insert(whatsappMessage)
      .values({
        conversationId: id,
        whatsappId,
        direction: "outgoing",
        type: "template",
        text: null,
        payload: "{}",
        sentAt: Date.UTC(2099, 0, 5, 12),
      })
      .run();
    return whatsappId;
  });
}

const minute = 60_000;

describe("storing the webhook's WhatsApp events", () => {
  it("stores an incoming message once, and says so when Meta repeats it", async () => {
    const { organization } = await setUpTestOrganization();
    const message = incoming("+5493515551234");

    const first = await organization.storeWhatsappEvents({
      templateStatuses: [],
      messages: [message],
      statuses: [],
    });
    const second = await organization.storeWhatsappEvents({
      templateStatuses: [],
      messages: [message],
      statuses: [],
    });

    expect(first).toEqual({
      ok: true,
      messages: [{ whatsappId: message.whatsappId, alreadyStored: false }],
      statuses: [],
      templateStatuses: [],
    });
    expect(second).toEqual({
      ok: true,
      messages: [{ whatsappId: message.whatsappId, alreadyStored: true }],
      statuses: [],
      templateStatuses: [],
    });
    expect(await storedMessages(organization)).toMatchObject([
      { whatsappId: message.whatsappId, phone: "+5493515551234" },
    ]);
  });

  it("links a guardian's number to every patient it is the message contact of, and no one else", async () => {
    const { organization } = await setUpTestOrganization();
    const mother = { name: "Laura Gómez", relationship: "Madre", phone: "0351 15 444-0000" };
    const tomas = await registered(organization, "Tomás", "0351 15 555-1111");
    const lucia = await registered(organization, "Lucía", "0351 15 555-2222");
    // The mother is this patient's guardian too, but his messages go to his own phone.
    const mateo = await registered(organization, "Mateo", "0351 15 555-3333");
    // This patient's own phone is the mother's, but her messages go to another guardian.
    const sofia = await registered(organization, "Sofía", "0351 15 444-0000");
    for (const { receptionist, patientId } of [tomas, lucia]) {
      const guardian = expectOk(
        await organization.addGuardian(receptionist, { patientId, ...mother }),
      );
      expectOk(
        await organization.setMessageContact(receptionist, {
          patientId,
          guardianId: guardian.guardian.id,
        }),
      );
    }
    expectOk(
      await organization.addGuardian(mateo.receptionist, { patientId: mateo.patientId, ...mother }),
    );
    const father = expectOk(
      await organization.addGuardian(sofia.receptionist, {
        patientId: sofia.patientId,
        name: "Juan Pérez",
        relationship: "Padre",
        phone: "0351 15 666-0000",
      }),
    );
    expectOk(
      await organization.setMessageContact(sofia.receptionist, {
        patientId: sofia.patientId,
        guardianId: father.guardian.id,
      }),
    );

    await organization.storeWhatsappEvents({
      templateStatuses: [],
      messages: [incoming("+5493514440000"), incoming("+5493514440000")],
      statuses: [],
    });

    const [first, second] = await storedMessages(organization);
    expect(second?.conversationId).toBe(first?.conversationId);
    expect(await linkedPatients(organization, first!.conversationId)).toEqual(
      [tomas.patientId, lucia.patientId].sort(),
    );
  });

  it("links a patient's own number when no guardian is their message contact", async () => {
    const { organization } = await setUpTestOrganization();
    const tomas = await registered(organization, "Tomás", "0351 15 555-1111");

    await organization.storeWhatsappEvents({
      templateStatuses: [],
      messages: [incoming("+5493515551111")],
      statuses: [],
    });

    const [message] = await storedMessages(organization);
    expect(await linkedPatients(organization, message!.conversationId)).toEqual([tomas.patientId]);
  });

  it("links a number to more patients than one statement binds", async () => {
    const { organization } = await setUpTestOrganization();
    const receptionist = await addMember(organization, ["receptionist"]);
    const patientIds: string[] = [];
    for (let added = 0; added < 60; added++) {
      const result = expectOk(
        await organization.registerPatient(receptionist, {
          firstName: `Paciente ${added}`,
          lastName: "Pérez",
          phone: "0351 15 555-1111",
          confirmDuplicates: true,
        }),
      );
      patientIds.push(result.patient.id);
    }

    await organization.storeWhatsappEvents({
      templateStatuses: [],
      messages: [incoming("+5493515551111")],
      statuses: [],
    });

    const [message] = await storedMessages(organization);
    expect(await linkedPatients(organization, message!.conversationId)).toEqual(patientIds.sort());
  });

  it("links an Argentine mobile typed without its 15 to the number WhatsApp sends with a 9", async () => {
    const { organization } = await setUpTestOrganization();
    // Typed without the 15, the number is stored as +54 351 …; WhatsApp sends 549 351 ….
    const tomas = await registered(organization, "Tomás", "351 555-1111");

    await organization.storeWhatsappEvents({
      templateStatuses: [],
      messages: [incoming("+5493515551111")],
      statuses: [],
    });

    const [message] = await storedMessages(organization);
    expect(await linkedPatients(organization, message!.conversationId)).toEqual([tomas.patientId]);
  });

  it("stores a message from a number no patient has in a conversation with no patient", async () => {
    const { organization } = await setUpTestOrganization();
    await registered(organization, "Tomás", "0351 15 555-1111");

    await organization.storeWhatsappEvents({
      templateStatuses: [],
      messages: [incoming("+5491199990000")],
      statuses: [],
    });

    const [message] = await storedMessages(organization);
    expect(message?.phone).toBe("+5491199990000");
    expect(await linkedPatients(organization, message!.conversationId)).toEqual([]);
  });

  it("stores a status update on the outgoing message it names, and ignores an unknown one", async () => {
    const { organization } = await setUpTestOrganization();
    const whatsappId = await sentTo(organization, "+5493515551111");
    const sentAt = Date.UTC(2099, 0, 5, 12);

    const result = await organization.storeWhatsappEvents({
      templateStatuses: [],
      messages: [],
      statuses: [
        { whatsappId, status: "delivered", at: sentAt + minute },
        { whatsappId: "wamid.unknown", status: "read", at: sentAt + minute },
      ],
    });

    expect(result).toEqual({
      ok: true,
      messages: [],
      statuses: [
        { whatsappId, updated: true },
        { whatsappId: "wamid.unknown", updated: false },
      ],
      templateStatuses: [],
    });
    expect(await storedMessages(organization)).toMatchObject([{ whatsappId, status: "delivered" }]);
  });

  it("keeps the latest status when Meta's updates arrive out of order", async () => {
    const { organization } = await setUpTestOrganization();
    const whatsappId = await sentTo(organization, "+5493515551111");
    const sentAt = Date.UTC(2099, 0, 5, 12);

    await organization.storeWhatsappEvents({
      templateStatuses: [],
      messages: [],
      statuses: [{ whatsappId, status: "read", at: sentAt + 2 * minute }],
    });
    const late = expectOk(
      await organization.storeWhatsappEvents({
        templateStatuses: [],
        messages: [],
        statuses: [{ whatsappId, status: "delivered", at: sentAt + minute }],
      }),
    );

    expect(late.statuses).toEqual([{ whatsappId, updated: false }]);
    expect(await storedMessages(organization)).toMatchObject([{ whatsappId, status: "read" }]);
  });

  it("keeps read over delivered when Meta stamps both in the same second", async () => {
    const { organization } = await setUpTestOrganization();
    const whatsappId = await sentTo(organization, "+5493515551111");
    const at = Date.UTC(2099, 0, 5, 12, 1);

    await organization.storeWhatsappEvents({
      templateStatuses: [],
      messages: [],
      statuses: [
        { whatsappId, status: "read", at },
        { whatsappId, status: "delivered", at },
      ],
    });

    expect(await storedMessages(organization)).toMatchObject([{ whatsappId, status: "read" }]);
  });
});
