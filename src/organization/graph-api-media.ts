import type { Fetcher } from "#/organization/graph-api.ts";

// Meta's media host, the second half of a media download through the Graph
// API (`graph-api.ts`): the Graph API describes a patient's media with a link
// that lasts five minutes, and the bytes come from that link, streamed, with
// the number's token, which goes to Meta's own hosts only.

/**
 * The media's bytes as the media host streams them, with its own headers: its
 * length, whether it takes byte ranges, and for a byte range (`partial`) the
 * range it sent.
 */
export interface MediaHostAnswer {
  body: ReadableStream<Uint8Array>;
  partial: boolean;
  length: string | null;
  acceptRanges: string | null;
  contentRange: string | null;
}

/** Meta's link to a media's bytes; the token goes only to Meta's own hosts. */
function mediaUrl(url: string) {
  const { protocol, hostname } = new URL(url);
  const metaHost = [".fbsbx.com", ".facebook.com", ".whatsapp.net"].some((domain) =>
    hostname.endsWith(domain),
  );
  if (protocol !== "https:" || !metaHost) {
    throw new Error("The Graph API linked a media on another host");
  }
  return url;
}

/**
 * How long a media's download may take in all, its body included: longer than
 * Meta's other calls, since its body streams to the member's browser at the
 * browser's pace, or to a voice note's transcription.
 */
const mediaDeadlineMs = 5 * 60_000;

/** The bytes at Meta's link `url`, all of them or the byte `range`; throws when the host fails. */
export async function fromMediaHost(
  fetcher: Fetcher,
  url: string,
  authorization: string,
  range: string | null,
): Promise<MediaHostAnswer> {
  const response = await fetcher(mediaUrl(url), {
    headers: { authorization, ...(range && { range }) },
    signal: AbortSignal.timeout(mediaDeadlineMs),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Meta's media host answered ${response.status}`);
  }
  return {
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Workers types a fetched body as `ReadableStream<any>`; its chunks are bytes.
    body: response.body,
    partial: response.status === 206,
    length: response.headers.get("content-length"),
    acceptRanges: response.headers.get("accept-ranges"),
    contentRange: response.headers.get("content-range"),
  };
}
