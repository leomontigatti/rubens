import { DurableObject } from "cloudflare:workers";

import { accountsFor } from "#/organization/accounts.ts";
import type { Accounts } from "#/organization/accounts.ts";
import { migrateDatabase, openDatabase } from "#/organization/database.ts";
import type { Database } from "#/organization/database.ts";
import { whatsappCloudFor } from "#/organization/graph-api.ts";
import type { GraphApiSettings, WhatsappCloud } from "#/organization/graph-api.ts";
import { nextOutboxAlarm, sendDueMessages } from "#/organization/outbox.ts";
import type { EmailsInFlight } from "#/organization/staff.ts";

/**
 * What the organization's object runs on, under its RPC methods
 * (`organization.ts`): its SQLite storage, migrated before any call; the
 * services it reaches; and its one alarm (ADR-0008 § Jobs are Durable Object
 * alarms), always set to the earliest due item.
 */
export abstract class OrganizationRuntime extends DurableObject {
  protected readonly database: Database;
  /** The Clerk users staff sign in as (`src/organization/accounts.ts`). */
  protected readonly accounts: Accounts;
  /** The emails whose Clerk user a call is creating right now (`src/organization/staff.ts`). */
  protected readonly emailsInFlight: EmailsInFlight = new Set();
  /** Meta's WhatsApp Cloud API (`src/organization/graph-api.ts`). */
  protected readonly whatsapp: WhatsappCloud;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.database = openDatabase(ctx.storage);
    this.accounts = accountsFor(env as { CLERK_SECRET_KEY?: string });
    this.whatsapp = whatsappCloudFor(env as GraphApiSettings);
    void ctx.blockConcurrencyWhile(async () => {
      await migrateDatabase(this.database);
      await this.#armAlarm();
    });
  }

  /** Sends the outbox's due messages, then sets the alarm for the next one. */
  override async alarm() {
    await sendDueMessages(this.database, this.whatsapp);
    await this.#armAlarm();
  }

  /** Sets the alarm to the earliest due item, or clears it when nothing waits on time. */
  async #armAlarm() {
    const next = nextOutboxAlarm(this.database, this.whatsapp);
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next);
    }
  }

  /** Runs `work`, then sets the alarm for what it may have queued or let go. */
  protected async thenArm<T>(work: () => T): Promise<Awaited<T>> {
    const result = await work();
    await this.#armAlarm();
    return result;
  }
}
