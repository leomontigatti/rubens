import { eq } from "drizzle-orm";

import { signupCompletionSchema } from "#/lib/whatsapp.ts";
import type { SignupCompletion } from "#/lib/whatsapp.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database } from "#/organization/database.ts";
import type { OrganizationCipher, SealedPurpose } from "#/organization/encryption.ts";
import type {
  ConnectedNumber,
  GraphApiSettings,
  MetaError,
  MetaSignup,
} from "#/organization/graph-api.ts";
import type { Acting } from "#/organization/members.ts";
import { organization } from "#/organization/schema.ts";
import { whatsappConnection } from "#/organization/whatsapp-schema.ts";
import { activeHold, endHold } from "#/organization/whatsapp-limits.ts";
import type { ClaimResult, DirectoryEntry } from "#/server/whatsapp-directory.ts";

// The organization's WhatsApp number, connected through Meta's Embedded
// Signup v4 (ADR-0010 § A new number, owned by the practice): the popup
// returns a code, and the Worker exchanges it for the organization's business
// token, registers the number for the Cloud API and subscribes underthing's
// app to the account's webhooks. The token and the number's PIN are sealed
// with the organization's key and never leave the object; the WhatsApp
// directory (ADR-0012) maps the number to the organization for the webhook.
// Who may call each is the object's concern: an admin.

/** The directory, through the object's stub of it. */
export interface DirectoryWrites {
  /** Whether `entry` could be claimed, without claiming it. */
  check(entry: DirectoryEntry): Promise<ClaimResult>;
  claim(entry: DirectoryEntry): Promise<ClaimResult>;
  release(organizationId: string): Promise<void>;
}

export interface ConnectionServices {
  signup: MetaSignup;
  directory: DirectoryWrites;
  /** The organization's cipher, or `null` when the Worker has no key. */
  cipher(organizationId: string): Promise<OrganizationCipher | null>;
}

/** The connected number's token, opened from its sealed copy, which says which row it belongs to. */
interface OpenedToken {
  sealed: string;
  token: string;
}

type ConnectionRow = typeof whatsappConnection.$inferSelect;

const connectionId = 1;

export function organizationIdIn(database: Database): string | null {
  return database.select({ id: organization.id }).from(organization).get()?.id ?? null;
}

/** A two-step verification PIN of 6 digits, for registering a number. */
function newPin() {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1));
  return String(value % 1_000_000).padStart(6, "0");
}

/**
 * The organization's number, over its connection row: what the object sends
 * from, and connecting or disconnecting it. It holds the connected number's
 * token opened in memory, and lets one connection change run at a time, since
 * a change awaits Meta between its check and its write.
 */
export class WhatsappNumber {
  readonly #database: Database;
  readonly #services: ConnectionServices;
  #opened: OpenedToken | null = null;
  #changing = false;

  constructor(database: Database, services: ConnectionServices) {
    this.#database = database;
    this.#services = services;
  }

  #row(): ConnectionRow | null {
    return this.#database.select().from(whatsappConnection).get() ?? null;
  }

  /**
   * Opens the connected number's sealed token, when the object starts. A
   * token the Worker's key no longer opens (the key changed) leaves the
   * connection failed, to be connected again. A key that is missing or not a
   * key is the Worker's setting to fix: the connection is left as it is, and
   * sends nothing until the key is back. Neither keeps the object from starting.
   */
  async open() {
    const row = this.#row();
    const organizationId = organizationIdIn(this.#database);
    if (row?.state !== "connected" || !row.accessToken || !organizationId) {
      return;
    }
    const cipher = await this.#usableCipher(organizationId);
    if (!cipher) {
      return;
    }
    const token = await this.#opening(
      cipher,
      organizationId,
      row.accessToken,
      "whatsappAccessToken",
    );
    if (token) {
      this.#opened = { sealed: row.accessToken, token };
    } else {
      // No words of Meta's: the settings say the stored connection could not be used.
      this.#fail(null);
    }
  }

  /** The organization's cipher, or `null`, logged, when the Worker's key is missing or not a key. */
  async #usableCipher(organizationId: string) {
    try {
      const cipher = await this.#services.cipher(organizationId);
      if (!cipher) {
        console.error("[whatsapp-connection] ORGANIZATION_ENCRYPTION_KEY is not set");
      }
      return cipher;
    } catch {
      console.error("[whatsapp-connection] ORGANIZATION_ENCRYPTION_KEY is not a usable key");
      return null;
    }
  }

  /** `sealed` opened, or `null` when the key does not open it. */
  async #opening(
    cipher: OrganizationCipher,
    organizationId: string,
    sealed: string,
    purpose: SealedPurpose,
  ) {
    try {
      return await cipher.open(sealed, purpose);
    } catch {
      // The cipher's error says nothing more than that it did not open.
      console.error(
        `[whatsapp-connection] a sealed value of organization ${organizationId} did not open`,
      );
      return null;
    }
  }

  /** The connected number can no longer send: Meta's words, or `null` when they are not Meta's. */
  #fail(reason: string | null) {
    this.#opened = null;
    this.#database
      .update(whatsappConnection)
      .set({ state: "failed", failureReason: reason, accessToken: null })
      .where(eq(whatsappConnection.state, "connected"))
      .run();
  }

  /**
   * The number the object sends from, or `null` before any number connected,
   * when the Worker's configured test number applies. A connection that is
   * not connected, or whose token is not open, sends nothing.
   */
  settings(): GraphApiSettings | null {
    const row = this.#row();
    if (!row) {
      return null;
    }
    const connected = row.state === "connected";
    // A connected number whose token is not open lacks the Worker's key: its token is missing, not failed.
    const opened = this.#opened?.sealed === row.accessToken ? this.#opened?.token : undefined;
    return {
      WHATSAPP_ACCESS_TOKEN: connected ? opened : undefined,
      WHATSAPP_PHONE_NUMBER_ID: row.phoneNumberId,
      WHATSAPP_BUSINESS_ACCOUNT_ID: row.businessAccountId,
      connectionFailed: !connected,
    };
  }

  /** What the settings show of the connection: never its token or PIN. */
  read() {
    const row = this.#row();
    if (!row) {
      return null;
    }
    const { displayNumber, messagingLimit, state, failureReason, updatedAt } = row;
    return { displayNumber, messagingLimit, state, failureReason, updatedAt };
  }

  /** What the browser launches Embedded Signup with, or `null` while the Worker misses a setting. */
  launch() {
    return this.#services.signup.launch();
  }

  /** The signup setting the Worker misses, if any, which keeps `launch()` empty. */
  missingSignupSetting() {
    return this.#services.signup.missingSetting();
  }

  /**
   * Meta refused `token`: it expired, or the business revoked it. When it is
   * still the connected number's, the connection shows as failed with Meta's
   * words, and its token is dropped, until an admin connects again. A refusal
   * of an earlier token, answered late, changes nothing.
   */
  tokenRefused(error: MetaError, token: string) {
    if (this.#opened?.token === token) {
      this.#fail(error.message);
    }
  }

  /** Runs one connection change, refusing another while it runs. */
  async #oneAtATime<T>(change: () => Promise<T>) {
    if (this.#changing) {
      return { ok: false, reason: "alreadyChanging" } as const;
    }
    this.#changing = true;
    try {
      return await change();
    } finally {
      this.#changing = false;
    }
  }

  /**
   * Completes Embedded Signup for `input`'s number, as `acting`. The directory
   * maps the number before Meta starts sending its events; when Meta refuses
   * registering or subscribing, it maps the organization's earlier number
   * again, and nothing is stored.
   */
  connect(acting: Acting, input: SignupCompletion) {
    return this.#oneAtATime(() => this.#connect(acting, input));
  }

  async #connect(acting: Acting, input: SignupCompletion) {
    const parsed = signupCompletionSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, reason: "invalidInput" } as const;
    }
    const organizationId = organizationIdIn(this.#database);
    const cipher = organizationId ? await this.#usableCipher(organizationId) : null;
    if (!organizationId || !cipher || !this.launch()) {
      return { ok: false, reason: "signupNotConfigured" } as const;
    }
    // Read before Meta's calls: a hold Meta puts on the new account meanwhile is not this one.
    const heldBefore = activeHold(this.#database, Date.now());
    const { code, phoneNumberId, businessAccountId } = parsed.data;
    const entry = { phoneNumberId, businessAccountId, organizationId };
    const free = await this.#services.directory.check(entry);
    if (!free.ok) {
      return free;
    }
    const found = await this.#accountNumber(code, phoneNumberId, businessAccountId);
    if (!found.ok) {
      return found;
    }
    const pin = await this.#pinFor(cipher, organizationId, phoneNumberId);
    const joined = await this.#claimedWhile(entry, () => this.#joinAtMeta(found.token, entry, pin));
    if (!joined.ok) {
      return joined;
    }
    const sealed = {
      accessToken: await cipher.seal(found.token, "whatsappAccessToken"),
      pin: await cipher.seal(pin, "whatsappPin"),
    };
    this.#store(acting, entry, found.number, sealed, heldBefore);
    this.#opened = { sealed: sealed.accessToken, token: found.token };
    return { ok: true } as const;
  }

  /** The business token for `code`, and the number, read from the account Meta signed up. */
  async #accountNumber(code: string, phoneNumberId: string, businessAccountId: string) {
    const { signup } = this.#services;
    const exchanged = await signup.exchangeCode(code);
    if (!exchanged.ok) {
      return exchanged;
    }
    const { token } = exchanged;
    const read = await signup.readNumber(token, businessAccountId, phoneNumberId);
    if (!read.ok) {
      return read;
    }
    return read.number
      ? ({ ok: true, token, number: read.number } as const)
      : ({ ok: false, reason: "numberNotInAccount" } as const);
  }

  /** Registers the number and subscribes the app to its account's webhooks. */
  async #joinAtMeta(token: string, entry: DirectoryEntry, pin: string) {
    const { signup } = this.#services;
    const registered = await signup.registerNumber(token, entry.phoneNumberId, pin);
    return registered.ok ? signup.subscribeApp(token, entry.businessAccountId) : registered;
  }

  /**
   * Runs `work` with `entry` claimed in the directory. When `work` is refused
   * or throws, the directory maps the organization's earlier number again, or
   * none; `#oneAtATime` keeps the earlier number from changing meanwhile.
   */
  async #claimedWhile<T extends { ok: boolean }>(entry: DirectoryEntry, work: () => Promise<T>) {
    const previous = this.#row();
    const claimed = await this.#services.directory.claim(entry);
    if (!claimed.ok) {
      return claimed;
    }
    const restore = () =>
      previous && previous.state !== "disconnected"
        ? this.#services.directory.claim({ ...previous, organizationId: entry.organizationId })
        : this.#services.directory.release(entry.organizationId);
    try {
      const result = await work();
      if (!result.ok) {
        await restore();
      }
      return result;
    } catch (error) {
      await restore();
      throw error;
    }
  }

  /**
   * The PIN the number was registered with before, since Meta asks for it
   * again; a new one for another number, or when the stored one does not open.
   */
  async #pinFor(cipher: OrganizationCipher, organizationId: string, phoneNumberId: string) {
    const row = this.#row();
    const stored =
      row?.phoneNumberId === phoneNumberId && row.pin
        ? await this.#opening(cipher, organizationId, row.pin, "whatsappPin")
        : null;
    return stored ?? newPin();
  }

  #store(
    acting: Acting,
    entry: DirectoryEntry,
    number: ConnectedNumber,
    sealed: { accessToken: string; pin: string },
    heldBefore: ReturnType<typeof activeHold>,
  ) {
    const previous = this.#row();
    const values = {
      businessAccountId: entry.businessAccountId,
      phoneNumberId: entry.phoneNumberId,
      displayNumber: number.displayNumber,
      messagingLimit: number.messagingLimit,
      state: "connected" as const,
      failureReason: null,
      ...sealed,
      connectedBy: acting.userId,
    };
    this.#database.transaction((tx) => {
      tx.insert(whatsappConnection)
        .values({ id: connectionId, ...values })
        .onConflictDoUpdate({ target: whatsappConnection.id, set: values })
        .run();
      if (heldBefore && previous?.businessAccountId !== entry.businessAccountId) {
        endHold(tx, heldBefore);
      }
      recordAudit(tx, acting.userId, {
        action: previous ? "update" : "create",
        entityType: "whatsappConnection",
        entityId: entry.phoneNumberId,
        patientId: null,
        before: previous && { phoneNumberId: previous.phoneNumberId, state: previous.state },
        after: {
          phoneNumberId: entry.phoneNumberId,
          businessAccountId: entry.businessAccountId,
          state: "connected",
        },
      });
    });
  }

  /**
   * Disconnects the number, as `acting`: its token is dropped and the
   * directory forgets it, so its events reach no one until a number connects
   * again. Its sealed PIN is kept, which registering the number again needs.
   */
  disconnect(acting: Acting) {
    return this.#oneAtATime(() => this.#disconnect(acting));
  }

  async #disconnect(acting: Acting) {
    const row = this.#row();
    const organizationId = organizationIdIn(this.#database);
    if (!row || row.state === "disconnected" || !organizationId) {
      return { ok: false, reason: "notConnected" } as const;
    }
    await this.#services.directory.release(organizationId);
    this.#opened = null;
    this.#database.transaction((tx) => {
      tx.update(whatsappConnection)
        .set({ state: "disconnected", failureReason: null, accessToken: null })
        .run();
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "whatsappConnection",
        entityId: row.phoneNumberId,
        patientId: null,
        before: { phoneNumberId: row.phoneNumberId, state: row.state },
        after: { phoneNumberId: row.phoneNumberId, state: "disconnected" },
      });
    });
    return { ok: true } as const;
  }
}
