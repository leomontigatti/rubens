import * as z from "zod";

// The media of a patient's WhatsApp message (a voice note, a photo, a video or
// a file), read from the payload Meta's webhook stored with it: what it is,
// its media id at Meta and until when Meta keeps it (docs/domain/assistant.md
// § Inbox). Nothing of the media itself is stored.

/**
 * How long Meta keeps a patient's media after it was sent: a webhook's media
 * id downloads for 7 days.
 */
export const mediaKeptMs = 7 * 24 * 60 * 60_000;

/** Meta's message types whose media the inbox opens. */
const mediaKinds = ["audio", "image", "video", "document"] as const;

export type MediaKind = (typeof mediaKinds)[number];

/** A message's media as the inbox shows it: what it is, its file name, and until when Meta has it. */
export interface MessageMedia {
  kind: MediaKind;
  /** A file's name as the patient sent it; none for the other kinds. */
  filename: string | null;
  availableUntil: number;
}

const mediaPayloadSchema = z.object({
  id: z.string().min(1),
  filename: z.string().optional(),
});

function isMediaKind(type: string): type is MediaKind {
  return (mediaKinds as readonly string[]).includes(type);
}

/** The media of a patient's message of `type`, read from Meta's `payload`; `null` for one that has none. */
export function mediaIn(type: string, payload: string) {
  if (!isMediaKind(type)) {
    return null;
  }
  let message: unknown;
  try {
    message = JSON.parse(payload);
  } catch (error) {
    // A payload the object stored itself is JSON; anything else carries no media.
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  const parsed = mediaPayloadSchema.safeParse((message as Record<string, unknown> | null)?.[type]);
  if (!parsed.success) {
    return null;
  }
  return { kind: type, mediaId: parsed.data.id, filename: parsed.data.filename ?? null };
}

/** The media of an incoming message, as the inbox shows it; `null` for one with none. */
export function messageMediaOf(message: {
  direction: string;
  type: string;
  payload: string;
  sentAt: number;
}): MessageMedia | null {
  const media = message.direction === "incoming" ? mediaIn(message.type, message.payload) : null;
  if (!media) {
    return null;
  }
  return {
    kind: media.kind,
    filename: media.filename,
    availableUntil: message.sentAt + mediaKeptMs,
  };
}
