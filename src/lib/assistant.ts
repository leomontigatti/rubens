import * as z from "zod";

import type { FormOfAddress } from "#/lib/communication-rules.ts";

// The patient assistant's words to the model (docs/domain/assistant.md § For
// patients, ADR-0006 § The model interprets, underthing decides): its system
// prompt and its tools' schemas. Only the rules the model has to keep are
// here; what underthing decides (who a number may hear about, when a reply
// may go, the fixed checks) is the object's (`src/organization/assistant.ts`).
// The evaluation set runs this same prompt and these schemas
// (`tests/evals/assistant/`).

/** The model the assistant runs on, decided on #151 from the evaluation report. */
export const assistantModelId = "claude-haiku-5-5";

/** How long the assistant waits after a patient's message before its turn (§ Pace). */
export const assistantWaitMs = 8_000;

/**
 * The line before the patient's new messages in a turn: what follows it is
 * what the turn judges. The model's provider joins consecutive messages of
 * one side, so without it the conversation so far and the new messages read
 * as one.
 */
export const newMessagesMark = "[new messages]";

// The mark however a patient might type it: any case, any spacing inside the
// brackets, anywhere in a line.
const typedMark = /\[\s*new\s+messages\s*\]/giu;

/**
 * A patient's `text` with the mark escaped wherever they typed it, its
 * brackets turned to parentheses, so only underthing places the boundary of
 * what the turn judges. Escaping, not deleting: deleting the inner mark of
 * `[new [new messages]messages]` would leave a mark behind.
 */
export function withoutMark(text: string): string {
  return text.replace(typedMark, (typed) => `(${typed.slice(1, -1)})`);
}

/** The tools a turn can call, each run by the object with the permissions of the patient's number. */
export const assistantToolSchemas = {
  list_patients: {
    description:
      "The patients this WhatsApp number is the contact of, each with their upcoming appointments (id, date, time, status).",
    inputSchema: z.object({}),
  },
  get_appointment: {
    description:
      "One upcoming appointment's medical service, practitioner, date, time, office and the office's address.",
    inputSchema: z.object({
      appointmentId: z.string().describe("The appointmentId list_patients returned"),
    }),
  },
  judge_messages: {
    description: "Records the judgement of the patient's new messages. Call it once every turn.",
    inputSchema: z.object({
      clinical: z.boolean().describe("Mentions symptoms, a study, a treatment or how they feel"),
      emergency: z.boolean().describe("A risk to life or health right now"),
    }),
  },
} as const;

export type AssistantToolName = keyof typeof assistantToolSchemas;

export interface PromptContext {
  organizationName: string;
  /** Now, as the patient reads the time: in the organization's office's zone. */
  now: Date;
  timeZone: string;
  formOfAddress: FormOfAddress;
  /** The organization's tone text; empty when it set none. */
  tone: string;
  /**
   * What later tickets let the assistant do, and the rules that come with it:
   * the evaluation set adds its drafts here until they land.
   */
  more?: { capabilities: string[]; rules: string[] };
}

/** `now` as the prompt states it, such as `2099-01-05 09:00 (America/Argentina/Buenos_Aires)`. */
function localNow(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((one) => one.type === type)?.value;
  return `${part("weekday")} ${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} (${timeZone})`;
}

export function assistantSystemPrompt(context: PromptContext): string {
  const capabilities = [
    "- Say when, where and with whom an appointment is.",
    ...(context.more?.capabilities ?? []),
  ];
  const rules = [
    `Every turn, call judge_messages exactly once, about the patient's new messages: clinical (symptoms, a study, a treatment, how they feel, a photo) and emergency (a risk to life or health right now). The new messages are what follows the line "${newMessagesMark}" in the patient's last message.`,
    "The number may stand for several patients. Call list_patients first. If it lists more than one patient and the patient has not said which one, ask which one before telling or doing anything about an appointment.",
    "Never state a date, time, office, address, practitioner or availability that a tool did not return.",
    ...(context.more?.rules ?? []),
    "Never give clinical advice, never say whether a symptom is normal, never suggest a medicine or a treatment. Clinical messages go to the practitioner.",
    "If asked whether you are a bot or a person, say plainly that you are the practice's automated assistant. Do not say so unprompted.",
    "Never say anything about a patient this number is not the contact of.",
  ];
  const tone = context.tone ? `\nThe practice describes its tone as: ${context.tone}\n` : "";
  return `You are the WhatsApp assistant of ${context.organizationName}, a health practice in Argentina. You answer patients about appointments they already have.

Now: ${localNow(context.now, context.timeZone)}. Write in Argentine Spanish, addressing the patient as "${context.formOfAddress}", short and warm, as the practice's receptionist would. No emojis, no opening "¿" or "¡". At most three short paragraphs. Do not sign off.
${tone}
What you can do, only through your tools:
${capabilities.join("\n")}

Rules you always keep:
${rules.map((rule, index) => `${index + 1}. ${rule}`).join("\n")}`;
}

/** `reply` with the organization's sign-off on its own line, when it has one. */
export function withSignOff(reply: string, signOff: string): string {
  const body = reply.trim();
  return signOff ? `${body}\n${signOff}` : body;
}
