import { DurableObject } from "cloudflare:workers";

import { fakeMetaFetch, fakesMeta } from "#/dev/fake-meta.ts";
import { fakeModel, fakesModel } from "#/dev/fake-model.ts";
import { accountsFor } from "#/organization/accounts.ts";
import { assistantTurnsJob } from "#/organization/assistant.ts";
import { conversationReturnsJob } from "#/organization/conversation-holds.ts";
import { handoffRemindersJob } from "#/organization/handoff-countdown.ts";
import { lateRepliesJob } from "#/organization/late-replies.ts";
import { assistantModelFor } from "#/organization/assistant-model.ts";
import type { AssistantModel } from "#/organization/assistant-model.ts";
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
import type { Job, JobServices } from "#/organization/jobs.ts";
import { optOutRemindersJob } from "#/organization/opt-out-holds.ts";
import { outboxJob } from "#/organization/outbox.ts";
import { authorize } from "#/organization/members.ts";
import type { Acting, Caller, Refusal, Requirement } from "#/organization/members.ts";
import type { EmailsInFlight } from "#/organization/staff.ts";
import { transcriberFor } from "#/organization/transcription.ts";
import type { Transcriber } from "#/organization/transcription.ts";
import { organizationIdIn, WhatsappNumber } from "#/organization/whatsapp-connection.ts";
import type { WorkerEnv } from "#/server/caller.ts";
import { whatsappDirectoryName } from "#/server/whatsapp-directory.ts";

type RuntimeEnv = WorkerEnv &
  GraphApiSettings &
  SignupSettings & {
    CLERK_SECRET_KEY?: string;
    ORGANIZATION_ENCRYPTION_KEY?: string;
    /** A secret: the assistant's model's API key (`src/organization/assistant-model.ts`). */
    ANTHROPIC_API_KEY?: string;
    /** Workers AI, which transcribes voice notes (`src/organization/transcription.ts`). */
    AI?: Ai;
    /** `"true"` answers Meta's calls inside the Worker, for the browser suite (`src/dev/fake-meta.ts`). */
    WHATSAPP_FAKE_META?: string;
    /** `"true"` fakes the assistant's model inside the Worker, for a browser check (`src/dev/fake-model.ts`). */
    ASSISTANT_FAKE_MODEL?: string;
  };

/**
 * The object's jobs, in the order the alarm runs them. A new job is one entry
 * here; a reorder is a deliberate change of one line.
 */
export const jobs: readonly Job[] = [
  // What is already due to patients goes first: the queued messages, then the
  // late replies the patient answered (or their writers told they did not go).
  outboxJob,
  lateRepliesJob,
  // Before the turns, so a conversation whose hold ended has its turn in this alarm.
  conversationReturnsJob,
  assistantTurnsJob,
  // After the turns, which can open handoffs and hold patients for an opt-out.
  handoffRemindersJob,
  optOutRemindersJob,
];

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
  /** How many transactions the object has opened: a call that changed it wrote. */
  #transactionsOpened = 0;
  /** The patient assistant's model (`src/organization/assistant-model.ts`). */
  protected readonly assistant: AssistantModel;
  /** What transcribes patients' voice notes (`src/organization/transcription.ts`). */
  protected readonly transcriber: Transcriber;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    const workerEnv = env as unknown as RuntimeEnv;
    this.database = openDatabase(ctx.storage, () => this.#transactionsOpened++);
    this.accounts = accountsFor(workerEnv);
    this.assistant = fakesModel(workerEnv) ? fakeModel : assistantModelFor(workerEnv);
    this.transcriber = transcriberFor(workerEnv);
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
    this.whatsapp = whatsappCloudFor(
      {
        settings: () =>
          this.number.settings() ??
          configuredWhatsappSettings(workerEnv, organizationIdIn(this.database)),
        tokenRefused: (error, token) => this.number.tokenRefused(error, token),
      },
      fakesMeta(workerEnv) ? fakeMetaFetch : undefined,
    );
    void ctx.blockConcurrencyWhile(async () => {
      await migrateDatabase(this.database);
      await this.number.open();
      await this.#armAlarm();
    });
  }

  /**
   * Authorizes `caller` against the member table for `requirement`, then runs
   * `work` as them, then sets the alarm if it wrote: every RPC method that
   * takes a caller goes through here.
   */
  protected async as<T>(
    caller: Caller,
    requirement: Requirement,
    work: (acting: Acting) => T,
  ): Promise<Awaited<T> | { ok: false; reason: Refusal }> {
    const authorized = authorize(this.database, caller, requirement);
    return authorized.ok ? this.armingOnWrite(() => work(authorized.acting)) : authorized;
  }

  /** `as()` while the RPC methods move to it (#375). */
  protected asThenArm<T>(caller: Caller, requirement: Requirement, work: (acting: Acting) => T) {
    return this.as(caller, requirement, work);
  }

  /** Runs every job, in the order of `jobs`, then sets the alarm for the next item. */
  override async alarm() {
    const services = this.#jobServices();
    for (const job of jobs) {
      await job.run(this.database, services);
    }
    await this.#armAlarm();
  }

  /** Sets the alarm to the earliest due item, or clears it when nothing waits on time. */
  async #armAlarm() {
    const services = this.#jobServices();
    const due = jobs.map((job) => job.nextDue(this.database, services)).filter((at) => at !== null);
    const next = due.length > 0 ? Math.min(...due) : null;
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next);
    }
  }

  #jobServices(): JobServices {
    return { whatsapp: this.whatsapp, assistant: this.assistant, transcriber: this.transcriber };
  }

  /**
   * Runs `work`, then sets the alarm if it opened a transaction, even one
   * rolled back or followed by a throw. Read as a count before and after, so
   * a call that only read is not taken for one that wrote while it waited on
   * Clerk or Meta: at most, a read waiting on one arms after another's write.
   */
  protected async armingOnWrite<T>(work: () => T): Promise<Awaited<T>> {
    const before = this.#transactionsOpened;
    try {
      return await work();
    } finally {
      if (this.#transactionsOpened !== before) {
        await this.#armAlarm();
      }
    }
  }
}
