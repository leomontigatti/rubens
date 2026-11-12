import { and, eq } from "drizzle-orm";

import { byteRangeOf, mediaIn, mediaKeptMs } from "#/lib/message-media.ts";
import { messageReferenceSchema } from "#/lib/whatsapp-messages.ts";
import type { MessageReference } from "#/lib/whatsapp-messages.ts";

import type { Database } from "#/organization/database.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import { readerOf } from "#/organization/inbox.ts";
import type { Acting } from "#/organization/members.ts";
import { conversation, whatsappMessage } from "#/organization/whatsapp-schema.ts";

// A patient's voice note, photo, video or file, opened from the inbox
// (docs/domain/assistant.md § Inbox). Nothing is stored: each press fetches
// the media from Meta by the id in the message's payload, for whoever reads
// the conversation, and streams it through. Meta deletes it seven days after it
// was sent; the message stays, a voice note's transcript included.

/**
 * Opens the media of the message `input` for `acting`, streamed from Meta,
 * all of it or the byte `range` their player asks for. A message in a
 * conversation they may not read, or one with no media, is not found; media
 * past Meta's seven days is `expired`, without asking Meta.
 */
export async function openMessageMedia(
  database: Database,
  cloud: WhatsappCloud,
  acting: Acting,
  input: MessageReference,
  range: string | null,
) {
  const parsed = messageReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "invalidInput" } as const;
  }
  const found = readableMedia(database, acting, parsed.data);
  if (!found) {
    return { ok: false, reason: "notFound" } as const;
  }
  if (Date.now() >= found.sentAt + mediaKeptMs) {
    return { ok: false, reason: "expired" } as const;
  }
  const opened = await fromMeta(cloud, found.media.mediaId, byteRangeOf(range), input.messageId);
  if (!opened) {
    return { ok: false, reason: "metaUnavailable" } as const;
  }
  const { kind, filename } = found.media;
  return { ...opened, kind, filename };
}

/** The media of the patient's message `reference` in a conversation `acting` reads, with when it was sent. */
function readableMedia(
  database: Database,
  acting: Acting,
  { conversationId, messageId }: { conversationId: string; messageId: string },
) {
  const message = database
    .select({
      direction: whatsappMessage.direction,
      type: whatsappMessage.type,
      payload: whatsappMessage.payload,
      sentAt: whatsappMessage.sentAt,
    })
    .from(whatsappMessage)
    .innerJoin(conversation, eq(conversation.id, whatsappMessage.conversationId))
    .where(
      and(
        eq(whatsappMessage.id, messageId),
        eq(whatsappMessage.conversationId, conversationId),
        readerOf(database, acting).visible,
      ),
    )
    .get();
  const media = message?.direction === "incoming" ? mediaIn(message.type, message.payload) : null;
  return message && media ? { media, sentAt: message.sentAt } : null;
}

/** The media `mediaId` as Meta streams it, or `null` when Meta does not serve it, logged by message id alone. */
async function fromMeta(
  cloud: WhatsappCloud,
  mediaId: string,
  range: string | null,
  messageId: string,
) {
  if (cloud.missingSetting()) {
    return null;
  }
  const opened = await cloud.openMedia(mediaId, range).catch((error: unknown) => {
    // An error can quote Meta's answer, so only its class is logged.
    const why = error instanceof Error ? error.name : typeof error;
    console.error(`[conversation-media] Meta did not serve message ${messageId}: ${why}`);
    return null;
  });
  if (opened && !opened.ok) {
    console.error(
      `[conversation-media] Meta refused message ${messageId} (code ${opened.metaError.code})`,
    );
    return null;
  }
  return opened;
}
