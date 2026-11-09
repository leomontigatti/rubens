import { DurableObject } from "cloudflare:workers";

// The WhatsApp directory (ADR-0012): the one piece of state shared across
// organizations. One SQLite-backed object maps each organization's connected
// number, and the WhatsApp Business account it belongs to, to the
// organization, so Meta's webhook can find whose object an event goes to. It
// holds ids only, never a patient's data. The organization's object writes it
// when a number connects or disconnects (`src/organization/whatsapp-connection.ts`);
// the webhook reads it (`src/server/whatsapp-webhook.ts`).

/** The name of the one directory object. */
export const whatsappDirectoryName = "whatsapp-directory";

export interface DirectoryEntry {
  phoneNumberId: string;
  businessAccountId: string;
  organizationId: string;
}

export type ClaimResult = { ok: true } | { ok: false; reason: "numberTaken" | "accountTaken" };

export class WhatsappDirectory extends DurableObject {
  readonly #sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    // One row per organization: it connects one number at a time.
    this.#sql.exec(`CREATE TABLE IF NOT EXISTS connected_number (
      organization_id TEXT PRIMARY KEY,
      phone_number_id TEXT NOT NULL UNIQUE,
      business_account_id TEXT NOT NULL UNIQUE
    )`);
  }

  /** Whether the organization may claim the number and its account: refused while another organization has either. */
  check({ phoneNumberId, businessAccountId, organizationId }: DirectoryEntry): ClaimResult {
    if (this.#ownerOf("phone_number_id", phoneNumberId, organizationId)) {
      return { ok: false, reason: "numberTaken" };
    }
    if (this.#ownerOf("business_account_id", businessAccountId, organizationId)) {
      return { ok: false, reason: "accountTaken" };
    }
    return { ok: true };
  }

  /**
   * Maps the number and its account to the organization, in place of the
   * organization's earlier number; refused as `check` refuses.
   */
  claim(entry: DirectoryEntry): ClaimResult {
    const free = this.check(entry);
    if (!free.ok) {
      return free;
    }
    const { phoneNumberId, businessAccountId, organizationId } = entry;
    this.#sql.exec(
      `INSERT INTO connected_number (organization_id, phone_number_id, business_account_id)
       VALUES (?, ?, ?)
       ON CONFLICT (organization_id) DO UPDATE SET
         phone_number_id = excluded.phone_number_id,
         business_account_id = excluded.business_account_id`,
      organizationId,
      phoneNumberId,
      businessAccountId,
    );
    return { ok: true };
  }

  /** Forgets the organization's number: its events then reach no one. */
  release(organizationId: string) {
    this.#sql.exec("DELETE FROM connected_number WHERE organization_id = ?", organizationId);
  }

  organizationForNumber(phoneNumberId: string): string | null {
    return this.#organizationWhere("phone_number_id", phoneNumberId);
  }

  organizationForAccount(businessAccountId: string): string | null {
    return this.#organizationWhere("business_account_id", businessAccountId);
  }

  /** Whether an organization other than `organizationId` has `value` in `column`. */
  #ownerOf(
    column: "phone_number_id" | "business_account_id",
    value: string,
    organizationId: string,
  ) {
    const owner = this.#organizationWhere(column, value);
    return owner !== null && owner !== organizationId;
  }

  #organizationWhere(column: "phone_number_id" | "business_account_id", value: string) {
    const rows = this.#sql
      .exec<{ organization_id: string }>(
        `SELECT organization_id FROM connected_number WHERE ${column} = ?`,
        value,
      )
      .toArray();
    return rows[0]?.organization_id ?? null;
  }
}
