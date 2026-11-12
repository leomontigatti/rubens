// Meta's media host, the second half of a media download through the Graph
// API (`graph-api.ts`): the Graph API describes a patient's media with a link
// that lasts five minutes, and the bytes come from that link, streamed, with
// the number's token, which goes to Meta's own hosts only.

/** The media's bytes as the media host streams them, with its length and, for a byte range, the range it sent. */
export interface MediaHostAnswer {
  body: ReadableStream<Uint8Array>;
  length: string | null;
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

/** The bytes at Meta's link `url`, all of them or the byte `range`; throws when the host fails. */
export async function fromMediaHost(
  fetcher: typeof fetch,
  url: string,
  authorization: string,
  range: string | null,
): Promise<MediaHostAnswer> {
  const response = await fetcher(mediaUrl(url), {
    headers: { authorization, ...(range && { range }) },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Meta's media host answered ${response.status}`);
  }
  return {
    body: response.body,
    length: response.headers.get("content-length"),
    contentRange: response.headers.get("content-range"),
  };
}
