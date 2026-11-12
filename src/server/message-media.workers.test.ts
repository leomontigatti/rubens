import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  addStaff,
  adminCaller,
  expectOk,
  fakeMeta,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import { resolveCaller } from "#/server/caller.ts";
import type { VerifySession, WorkerEnv } from "#/server/caller.ts";
import { serveMessageMedia } from "#/server/message-media.ts";

// The inbox's media route (`/api/conversaciones/…/mensajes/…`): the request's
// session decides the caller, the organization's object decides what they
// read, and the media goes to the browser as Meta streams it, never cached.
// Meta is faked at its HTTP boundary.

vi.mock(import("#/organization/graph-api.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    whatsappCloudFor: (connection) => actual.whatsappCloudFor(connection, fakeMeta.fetch),
    metaSignupFor: () => actual.metaSignupFor(fakeMeta.signupSettings, fakeMeta.fetch),
    configuredWhatsappSettings: () => fakeMeta.settings,
  };
});

const bindings = env as unknown as WorkerEnv;
const martinaPhone = "+5491155550000";
const now = Date.UTC(2098, 11, 1, 12);
const dayMs = 24 * 60 * 60_000;

let organizationId: string;
let organization: OrganizationStub;
let receptionist: { userId: string };
let practitioner: { userId: string };

/** The route's answer to `caller`, signed in to the test's organization, for `reference`. */
async function served(
  caller: { userId: string } | null,
  reference: { conversationId: string; messageId: string },
  headers: Record<string, string> = {},
) {
  const verify: VerifySession = () =>
    Promise.resolve(caller ? { userId: caller.userId, organizationClaim: organizationId } : null);
  const request = new Request("https://underthing.test/api/media", { headers });
  return serveMessageMedia(
    request,
    await resolveCaller(request, bindings, "clerk", verify),
    reference,
  );
}

/** A media message Martina sent `daysAgo`, as Meta's webhook hands it over; returns its ids. */
// The fake media are text: read as bytes, so workerd does not warn about decoding an image or a voice note.
async function bytesOf(response: Response) {
  return new TextDecoder().decode(await response.arrayBuffer());
}

async function patientSends(type: string, body: Record<string, unknown>, daysAgo = 0) {
  const whatsappId = `wamid.${crypto.randomUUID()}`;
  expectOk(
    await organization.storeWhatsappEvents({
      messages: [
        {
          whatsappId,
          from: martinaPhone,
          sentAt: now - daysAgo * dayMs - 60_000,
          type,
          text: null,
          payload: JSON.stringify({ id: whatsappId, type, [type]: body }),
        },
      ],
      statuses: [],
      templateStatuses: [],
    }),
  );
  const [conversation] = expectOk(
    await organization.listConversations(receptionist, {}),
  ).conversations;
  const read = expectOk(
    await organization.readConversation(receptionist, { conversationId: conversation!.id }),
  );
  return { conversationId: conversation!.id, messageId: read.messages.at(-1)!.id };
}

/** A file Meta holds as `mediaId`, of `mimeType`, sent by Martina. */
function fileSent(type: string, mediaId: string, mimeType: string, extra = {}, daysAgo = 0) {
  fakeMeta.media.set(mediaId, new TextEncoder().encode(`bytes of ${mediaId}`));
  fakeMeta.mediaTypes.set(mediaId, mimeType);
  return patientSends(type, { id: mediaId, mime_type: mimeType, ...extra }, daysAgo);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  fakeMeta.reset();
  ({ organizationId, organization } = await setUpTestOrganization());
  receptionist = (await addStaff(organization, "Rita Paz", ["receptionist"])).caller;
  practitioner = (await addStaff(organization, "Juan Gómez")).caller;
  expectOk(
    await organization.registerPatient(adminCaller, {
      firstName: "Martina",
      lastName: "Paz",
      phone: martinaPhone,
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the media route", () => {
  it("streams a photo inline to reception, never cached and fenced off from the app", async () => {
    const photo = await fileSent("image", "media-photo", "image/jpeg");

    const response = await served(receptionist, photo);

    expect(response.status).toBe(200);
    expect(await bytesOf(response)).toBe("bytes of media-photo");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("relays the byte range a player asks for, as Safari needs to play a voice note, with the whole length", async () => {
    const voiceNote = await fileSent("audio", "media-voice", "audio/ogg; codecs=opus");
    const length = "bytes of media-voice".length;

    const whole = await served(receptionist, voiceNote);
    const firstBytes = await served(receptionist, voiceNote, { range: "bytes=0-1" });

    expect(whole.headers.get("content-length")).toBe(String(length));
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(firstBytes.status).toBe(206);
    expect(firstBytes.headers.get("content-range")).toBe(`bytes 0-1/${length}`);
    expect(firstBytes.headers.get("content-length")).toBe("2");
    expect(await bytesOf(firstBytes)).toBe("by");
  });

  it("claims no byte ranges when Meta's media host takes none, and sends the whole file", async () => {
    const voiceNote = await fileSent("audio", "media-voice", "audio/ogg");
    fakeMeta.mediaHostTakesRanges = false;

    const response = await served(receptionist, voiceNote, { range: "bytes=0-1" });

    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBeNull();
    expect(response.headers.get("content-range")).toBeNull();
    expect(await bytesOf(response)).toBe("bytes of media-voice");
  });

  it("asks Meta for the whole file when the range is not one a player sends", async () => {
    const voiceNote = await fileSent("audio", "media-voice", "audio/ogg");

    const response = await served(receptionist, voiceNote, { range: "bytes=0-1, x" });

    expect(response.status).toBe(200);
    expect(fakeMeta.requests.at(-1)?.range).toBeUndefined();
  });

  it("opens a PDF inline under its file name", async () => {
    const study = await fileSent("document", "media-study", "application/pdf", {
      filename: "Radiografía panorámica.pdf",
    });

    const response = await served(receptionist, study);

    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      "inline; filename*=UTF-8''Radiograf%C3%ADa%20panor%C3%A1mica.pdf",
    );
  });

  it("downloads a file a browser could run, such as a web page, instead of showing it", async () => {
    const page = await fileSent("document", "media-page", "text/html", { filename: "hola.html" });

    const response = await served(receptionist, page);

    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''hola.html",
    );
  });

  it("answers 401 signed out, and 404 to a practitioner the conversation was not handed to", async () => {
    const photo = await fileSent("image", "media-photo", "image/jpeg");

    expect((await served(null, photo)).status).toBe(401);
    expect((await served(practitioner, photo)).status).toBe(404);
  });

  it("answers 410 for media Meta deleted after seven days, and 502 when Meta does not serve it", async () => {
    const old = await fileSent("image", "media-old", "image/jpeg", {}, 8);
    const fresh = await fileSent("image", "media-fresh", "image/jpeg");
    fakeMeta.mediaHostFails = true;

    const gone = await served(receptionist, old);
    const failed = await served(receptionist, fresh);

    expect(gone.status).toBe(410);
    expect(failed.status).toBe(502);
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
  });
});
