import type { MessageReference } from "#/lib/whatsapp-messages.ts";

import type { ResolvedCaller } from "#/server/caller.ts";

// The inbox's media route: a patient's voice note, photo, video or file,
// streamed from Meta to the browser of a member who reads the conversation
// (docs/domain/assistant.md § Inbox). The object decides who reads it
// (`src/organization/conversation-media.ts`); this turns its answer into the
// response. The media is the patient's, so nothing caches it, and it is served
// as content of its own: what a browser could run as a page downloads
// instead, and nothing it shows can script the app.

/** The media types a browser shows in place, as WhatsApp sends them; anything else downloads. */
const shownInPlace = [
  /^image\/(jpeg|png|webp)$/,
  /^audio\/(ogg|mpeg|mp4|aac|amr|wav)$/,
  /^video\/(mp4|3gpp)$/,
  /^application\/pdf$/,
];

/** What a refused member's browser shows, in a tab or for an `<audio>` that cannot play. */
const refusals = {
  unauthenticated: { status: 401, text: "Tu sesión terminó. Ingresá de nuevo." },
  forbidden: { status: 403, text: "Solo el personal puede leer las conversaciones." },
  mustChangePassword: { status: 403, text: "Elegí una contraseña nueva para continuar." },
  invalidInput: { status: 404, text: "No encontramos ese mensaje." },
  notFound: { status: 404, text: "No encontramos ese mensaje, o no te derivaron su conversación." },
  expired: { status: 410, text: "Ya no está disponible en WhatsApp (pasaron más de 7 días)." },
  metaUnavailable: {
    status: 502,
    text: "WhatsApp no entregó el archivo. Probá de nuevo en un rato.",
  },
} as const;

const privateHeaders = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

/** `inline` or `attachment`, with the file's name as the patient sent it, when it has one. */
function disposition(kind: "inline" | "attachment", filename: string | null) {
  return filename ? `${kind}; filename*=UTF-8''${encodeURIComponent(filename)}` : kind;
}

/** The response to `request`, from the member `resolved`, for the media of the message `reference`. */
export async function serveMessageMedia(
  request: Request,
  resolved: ResolvedCaller,
  reference: MessageReference,
): Promise<Response> {
  const opened = resolved.ok
    ? await resolved.organization.openMessageMedia(
        resolved.caller,
        reference,
        request.headers.get("range"),
      )
    : resolved;
  if (!opened.ok) {
    const refusal = refusals[opened.reason];
    return new Response(refusal.text, {
      status: refusal.status,
      headers: { ...privateHeaders, "content-type": "text/plain; charset=utf-8" },
    });
  }
  // Meta's type can carry parameters (`audio/ogg; codecs=opus`); only the type decides.
  const mimeType = opened.mimeType.split(";")[0]!.trim().toLowerCase();
  const inPlace = shownInPlace.some((pattern) => pattern.test(mimeType));
  return new Response(opened.body, {
    status: opened.partial ? 206 : 200,
    headers: {
      ...privateHeaders,
      "content-type": inPlace ? opened.mimeType : "application/octet-stream",
      "content-disposition": disposition(inPlace ? "inline" : "attachment", opened.filename),
      ...(opened.acceptRanges && { "accept-ranges": opened.acceptRanges }),
      ...(opened.length && { "content-length": opened.length }),
      ...(opened.contentRange && { "content-range": opened.contentRange }),
      // A PDF is shown by the browser's own viewer, which a sandbox would block.
      ...(mimeType !== "application/pdf" && {
        "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
      }),
    },
  });
}
