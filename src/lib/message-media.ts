import * as z from "zod";

// The media of a patient's WhatsApp message (a voice note, a photo, a video or
// a file), read from the payload Meta's webhook stored with it
// (docs/domain/assistant.md § Inbox).

export const metaMediaRetentionMs = 7 * 24 * 60 * 60_000;

const mediaKinds = ["audio", "image", "video", "document"] as const;

export type MediaKind = (typeof mediaKinds)[number];

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

export function mediaIn(type: string, payload: string) {
  if (!isMediaKind(type)) {
    return null;
  }
  let message: unknown;
  try {
    message = JSON.parse(payload);
  } catch (error) {
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
    availableUntil: message.sentAt + metaMediaRetentionMs,
  };
}

/**
 * The byte range a browser's player asks for (`Range: bytes=0-1023`), which
 * Safari needs answered to play audio and video; `null` for none, or for any
 * other form, which gets the whole file.
 */
export function byteRangeOf(header: string | null) {
  return header && /^bytes=\d+-\d*$/.test(header) ? header : null;
}
