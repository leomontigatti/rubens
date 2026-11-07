// Meta signs each webhook call with the app secret: `X-Hub-Signature-256` is
// `sha256=` and the hex HMAC-SHA256 of the raw request body. The body is
// checked as bytes, before it is parsed, since re-serialized JSON would differ.

const signaturePattern = /^sha256=([0-9a-f]{64})$/i;

function bytesOfHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Whether `header` is Meta's signature of `body` with `appSecret`, compared in constant time. */
export async function isSignedByMeta(
  body: Uint8Array<ArrayBuffer>,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  const hex = header?.match(signaturePattern)?.[1];
  if (!hex) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, bytesOfHex(hex), body);
}
