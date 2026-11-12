import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addRefusedAdmin,
  expectOk,
  fakeMeta,
  inStorage,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import { handoff, handoffRecipient } from "#/organization/whatsapp-schema.ts";

// A patient's photo, video, file or voice note, opened from the inbox
// (docs/domain/assistant.md § Inbox): fetched from Meta on each press by
// whoever reads the conversation, never stored, and gone once Meta deletes it,
// seven days after it was sent. Meta is faked at its HTTP boundary.

vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

const martinaPhone = "+5491155550000";
const dayMs = 24 * 60 * 60_000;
const now = Date.UTC(2098, 11, 1, 12);

let world: Awaited<ReturnType<typeof setUpBookingWorld>>;

/** A photo's bytes, made up: what the fake Meta serves for it. */
const photoBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/**
 * A media message from Martina, as Meta's webhook hands it over, sent
 * `daysAgo`; returns the ids the inbox opens it by.
 */
async function patientSends(
  type: string,
  body: Record<string, unknown>,
  options: { daysAgo?: number; text?: string | null } = {},
) {
  const whatsappId = `wamid.${crypto.randomUUID()}`;
  expectOk(
    await world.organization.storeWhatsappEvents({
      messages: [
        {
          whatsappId,
          from: martinaPhone,
          sentAt: now - (options.daysAgo ?? 0) * dayMs - 60_000,
          type,
          text: options.text ?? null,
          payload: JSON.stringify({
            from: martinaPhone.slice(1),
            id: whatsappId,
            type,
            [type]: body,
          }),
        },
      ],
      statuses: [],
      templateStatuses: [],
    }),
  );
  const listed = expectOk(await world.organization.listConversations(world.receptionist, {}));
  const conversationId = listed.conversations[0]!.id;
  const read = expectOk(
    await world.organization.readConversation(world.receptionist, { conversationId }),
  );
  return { conversationId, messageId: read.messages.at(-1)!.id };
}

/** A photo Meta holds as `mediaId`, sent by Martina `daysAgo`. */
function photoSent(mediaId = "media-photo", daysAgo = 0) {
  fakeMeta.media.set(mediaId, photoBytes);
  fakeMeta.mediaTypes.set(mediaId, "image/jpeg");
  return patientSends("image", { id: mediaId, mime_type: "image/jpeg" }, { daysAgo });
}

/** The media of `reference` as `caller` opens it, whole. */
function opens(
  caller: { userId: string },
  reference: { conversationId: string; messageId: string },
) {
  return world.organization.openMessageMedia(caller, reference, null);
}

async function bytesOf(stream: ReadableStream) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  fakeMeta.reset();
  world = await setUpBookingWorld();
  await world.addPatient("Martina", martinaPhone);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("opening a patient's media from the inbox", () => {
  it("streams reception a photo from Meta, with its type, through the number's token", async () => {
    const photo = await photoSent();

    const opened = expectOk(await opens(world.receptionist, photo));

    expect(opened.mimeType).toBe("image/jpeg");
    expect(await bytesOf(opened.body)).toEqual(photoBytes);
    expect(fakeMeta.requests.map((request) => request.authorization)).toEqual([
      "Bearer test-access-token-never-shown",
      "Bearer test-access-token-never-shown",
    ]);
  });
});

describe("who opens a patient's media", () => {
  it("refuses a practitioner the media of a conversation not handed to them, and serves it once it is", async () => {
    const photo = await photoSent();

    expect(await opens(world.juan.caller, photo)).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(fakeMeta.requests).toEqual([]);

    await handedTo(photo.conversationId, world.juan.caller);
    const opened = expectOk(await opens(world.juan.caller, photo));
    expect(await bytesOf(opened.body)).toEqual(photoBytes);
  });

  it("finds no media in a text message, nor a message under another conversation's id", async () => {
    const photo = await photoSent();
    await patientSends("text", { body: "Hola" }, { text: "Hola" });
    const read = expectOk(
      await world.organization.readConversation(world.receptionist, {
        conversationId: photo.conversationId,
      }),
    );
    const text = read.messages.at(-1)!;

    expect(
      await opens(world.receptionist, {
        conversationId: photo.conversationId,
        messageId: text.id,
      }),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(
      await opens(world.receptionist, {
        conversationId: crypto.randomUUID(),
        messageId: photo.messageId,
      }),
    ).toEqual({ ok: false, reason: "notFound" });
  });

  it("is refused to anyone signed out, deactivated or still holding the starting password", async () => {
    const photo = await photoSent();
    const callers = [
      { userId: "user-nobody" },
      await addRefusedAdmin(world.organization, "deactivated"),
      await addRefusedAdmin(world.organization, "mustChangePassword"),
    ];

    const answers = await Promise.all(callers.map((caller) => opens(caller, photo)));

    expect(answers.map((answer) => (answer.ok ? "opened" : answer.reason))).toEqual([
      "unauthenticated",
      "unauthenticated",
      "mustChangePassword",
    ]);
    expect(fakeMeta.requests).toEqual([]);
  });
});

describe("media Meta no longer has, or does not serve", () => {
  it("says a photo sent more than seven days ago is gone, without asking Meta", async () => {
    const photo = await photoSent("media-old", 7);

    expect(await opens(world.receptionist, photo)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(fakeMeta.requests).toEqual([]);
  });

  it("serves a photo until its seventh day is over", async () => {
    const photo = await photoSent("media-six-days", 6);

    expectOk(await opens(world.receptionist, photo));
  });

  it("says Meta did not serve it when Meta refuses the media id, and when its media host fails", async () => {
    const photo = await photoSent();
    fakeMeta.mediaHostFails = true;

    expect(await opens(world.receptionist, photo)).toEqual({
      ok: false,
      reason: "metaUnavailable",
    });

    fakeMeta.mediaHostFails = false;
    fakeMeta.media.delete("media-photo");
    expect(await opens(world.receptionist, photo)).toEqual({
      ok: false,
      reason: "metaUnavailable",
    });
  });

  it("says Meta did not serve it when the number has no access token", async () => {
    const photo = await photoSent();
    fakeMeta.settings = { WHATSAPP_PHONE_NUMBER_ID: "123456789012345" };

    expect(await opens(world.receptionist, photo)).toEqual({
      ok: false,
      reason: "metaUnavailable",
    });
    expect(fakeMeta.requests).toEqual([]);
  });
});

describe("a patient's media in the conversation", () => {
  it("shows each message's media with its file name and until when Meta has it, and none for words", async () => {
    await patientSends("text", { body: "Hola" }, { text: "Hola" });
    await patientSends(
      "document",
      { id: "media-study", mime_type: "application/pdf", filename: "Radiografía.pdf" },
      { daysAgo: 2 },
    );
    await patientSends("audio", { id: "media-voice", voice: true }, { text: "Llegué bien" });
    const { conversationId } = await patientSends("video", { id: "media-video" });

    const read = expectOk(
      await world.organization.readConversation(world.receptionist, { conversationId }),
    );

    const sentAgo = (days: number) => now - days * dayMs - 60_000;
    expect(read.messages.map((message) => [message.type, message.media])).toEqual([
      [
        "document",
        { kind: "document", filename: "Radiografía.pdf", availableUntil: sentAgo(2) + 7 * dayMs },
      ],
      ["text", null],
      ["audio", { kind: "audio", filename: null, availableUntil: sentAgo(0) + 7 * dayMs }],
      ["video", { kind: "video", filename: null, availableUntil: sentAgo(0) + 7 * dayMs }],
    ]);
  });
});

/** Hands Martina's conversation to `caller`, as an open handoff the assistant opened. */
async function handedTo(conversationId: string, caller: { userId: string }) {
  await inStorage(world.organization, (database) => {
    const opened = database
      .insert(handoff)
      .values({ conversationId, reason: "media", forPractitioner: false })
      .returning({ id: handoff.id })
      .get();
    database
      .insert(handoffRecipient)
      .values({ handoffId: opened.id, memberId: caller.userId })
      .run();
  });
}
