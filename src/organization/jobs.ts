import type { AssistantModel } from "#/organization/assistant-model.ts";
import type { Database } from "#/organization/database.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import type { Transcriber } from "#/organization/transcription.ts";

/** The services the object's jobs reach; each job reads what it needs. */
export interface JobServices {
  whatsapp: WhatsappCloud;
  assistant: AssistantModel;
  transcriber: Transcriber;
}

/**
 * One kind of work the object's alarm runs (ADR-0008 § Jobs are Durable Object
 * alarms): the runtime's list of them (`organization-runtime.ts`) both runs
 * them and sets the alarm to the earliest `nextDue`.
 */
export interface Job {
  /** For logs and tests only. */
  name: string;
  /** The earliest instant this job has work, or `null`: synchronous, and reads only. */
  nextDue(database: Database, services: JobServices): number | null;
  /** Does the job's due work. */
  run(database: Database, services: JobServices): void | Promise<void>;
}
