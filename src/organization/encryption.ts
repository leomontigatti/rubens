// The organization's encryption key (ADR-0008 § Clinical text and files are
// encrypted by the app). Each organization's key is derived with HKDF from the
// Worker secret `ORGANIZATION_ENCRYPTION_KEY` and the organization's id, so
// no two organizations share a key and none is stored. A sealed value is bound
// to its organization and its purpose: one sealed for another organization,
// or as another kind of value, does not open.

/** What a sealed value is, bound into it so it opens only as that. */
export type SealedPurpose = "whatsappAccessToken" | "whatsappPin";

export interface OrganizationCipher {
  seal(plaintext: string, purpose: SealedPurpose): Promise<string>;
  open(sealed: string, purpose: SealedPurpose): Promise<string>;
}

const format = "v1";
const ivBytes = 12;

function base64Of(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function bytesOf(base64: string) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/**
 * The cipher of `organizationId`, or `null` when the Worker has no key: a
 * value the app encrypts is then refused, never stored in clear.
 */
export async function organizationCipher(
  secret: string | undefined,
  organizationId: string,
): Promise<OrganizationCipher | null> {
  if (!secret) {
    return null;
  }
  const master = bytesOf(secret);
  if (master.length < 32) {
    throw new Error("ORGANIZATION_ENCRYPTION_KEY must be at least 32 bytes, in base64");
  }
  const encoder = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: encoder.encode(`underthing organization ${organizationId}`),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const additionalData = (purpose: SealedPurpose) => encoder.encode(`${organizationId} ${purpose}`);

  return {
    async seal(plaintext, purpose) {
      const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
      const sealed = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: additionalData(purpose) },
        key,
        encoder.encode(plaintext),
      );
      const bytes = new Uint8Array(ivBytes + sealed.byteLength);
      bytes.set(iv);
      bytes.set(new Uint8Array(sealed), ivBytes);
      return `${format}:${base64Of(bytes)}`;
    },
    async open(sealed, purpose) {
      const [version, body] = sealed.split(":");
      if (version !== format || !body) {
        throw new Error("A sealed value is not in a format this cipher reads");
      }
      const bytes = bytesOf(body);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(0, ivBytes), additionalData: additionalData(purpose) },
        key,
        bytes.slice(ivBytes),
      );
      return new TextDecoder().decode(plaintext);
    },
  };
}
