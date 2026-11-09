import { DurableObject } from "cloudflare:workers";

import { accountsFor } from "#/organization/accounts.ts";
import type { Accounts } from "#/organization/accounts.ts";
import { migrateDatabase, openDatabase } from "#/organization/database.ts";
import type { Database } from "#/organization/database.ts";
import { organizationCipher } from "#/organization/encryption.ts";
import {
  configuredWhatsappSettings,
  metaSignupFor,
  whatsappCloudFor,
} from "#/organization/graph-api.ts";
import type { GraphApiSettings, SignupSettings, WhatsappCloud } from "#/organization/graph-api.ts";
import { nextOutboxAlarm, sendDueMessages } from "#/organization/outbox.ts";
import { authorize } from "#/organization/members.ts";
import type { Acting, Caller, Refusal, Requirement } from "#/organization/members.ts";
import type { EmailsInFlight } from "#/organization/staff.ts";
import { organizationIdIn, WhatsappNumber } from "#/organization/whatsapp-connection.ts";
import type { WorkerEnv } from "#/server/caller.ts";
import { whatsappDirectoryName } from "#/server/whatsapp-directory.ts";

type RuntimeEnv = WorkerEnv &
  GraphApiSettings &
  SignupSettings & { CLERK_SECRET_KEY?: string; ORGANIZATION_ENCRYPTION_KEY?: string };

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
  /**
   * Meta's WhatsApp Cloud API (`src/organization/graph-api.ts`), through the
   * organization's connected number, or the Worker's test number before one connects.
   */
  protected readonly whatsapp: WhatsappCloud;
  /** The organization's number, connected through Embedded Signup (`src/organization/whatsapp-connection.ts`). */
  protected readonly number: WhatsappNumber;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    const workerEnv = env as unknown as RuntimeEnv;
    this.database = openDatabase(ctx.storage);
    this.accounts = accountsFor(workerEnv);
    const directory = workerEnv.WHATSAPP_DIRECTORY.get(
      workerEnv.WHATSAPP_DIRECTORY.idFromName(whatsappDirectoryName),
    );
    this.number = new WhatsappNumber(this.database, {
      signup: metaSignupFor(workerEnv),
      directory: {
        check: (entry) => directory.check(entry),
        claim: (entry) => directory.claim(entry),
        release: (organizationId) => directory.release(organizationId),
      },
      cipher: (organizationId) =>
        organizationCipher(workerEnv.ORGANIZATION_ENCRYPTION_KEY, organizationId),
    });
    this.whatsapp = whatsappCloudFor({
      settings: () =>
        this.number.settings() ??
        configuredWhatsappSettings(workerEnv, organizationIdIn(this.database)),
      tokenRefused: (error, token) => this.number.tokenRefused(error, token),
    });
    void ctx.blockConcurrencyWhile(async () => {
      await migrateDatabase(this.database);
      await this.number.open();
      await this.#armAlarm();
    });
  }

  /**
   * Authorizes `caller` against the member table for `requirement`, then runs
   * `work` as them: every RPC method that takes a caller goes through here.
   */
  protected as<T>(
    caller: Caller,
    requirement: Requirement,
    work: (acting: Acting) => T,
  ): T | { ok: false; reason: Refusal } {
    const authorized = authorize(this.database, caller, requirement);
    return authorized.ok ? work(authorized.acting) : authorized;
  }

  /** `as()` for a call that can queue a message or let one go: the alarm is set after it. */
  protected asThenArm<T>(caller: Caller, requirement: Requirement, work: (acting: Acting) => T) {
    return this.thenArm(() => this.as(caller, requirement, work));
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
