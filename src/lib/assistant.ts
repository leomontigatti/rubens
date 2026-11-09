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

/**
 * A patient's `text` with every bracket turned to a parenthesis, so only
 * underthing places the boundary of what the turn judges: no message, nor
 * the messages of a burst joined, can then spell the mark in any form.
 */
export function withoutMark(text: string): string {
  return text.replaceAll("[", "(").replaceAll("]", ")");
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
      understood: z
        .boolean()
        .default(true)
        .describe(
          "False when you cannot tell what the patient wants and have to ask them to say it again",
        ),
      optOut: z
        .boolean()
        .default(false)
        .describe(
          "True when the patient asks the practice to stop sending them messages, or not to write to them again",
        ),
      followUpAnswer: z
        .enum(["plainlyGood", "other"])
        .optional()
        .describe(
          "Only when the new messages answer the practice's follow-up (how they feel after an appointment): plainlyGood when they plainly say they are well, with nothing to ask or report; other otherwise",
        ),
    }),
  },
  find_free_times: {
    description:
      "The free times the appointment can move to: same practitioner and medical service, any of their offices, over the next 3 weeks, at most 20 at a time. Refuses when the move is not allowed.",
    inputSchema: z.object({
      appointmentId: z.string().describe("The appointmentId list_patients returned"),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/u)
        .optional()
        .describe(
          "Only times from this local date (YYYY-MM-DD) or date and time (YYYY-MM-DDTHH:MM) on, to see later ones",
        ),
    }),
  },
  propose_change: {
    description:
      "Stores a proposal to confirm, cancel or move an appointment, and returns it in full. It replaces any earlier proposal. Nothing changes until accept_proposal.",
    inputSchema: z.object({
      appointmentId: z.string().describe("The appointmentId list_patients returned"),
      kind: z.enum(["confirm", "cancel", "move"]),
      slotId: z.string().optional().describe("For a move: the slotId find_free_times returned"),
    }),
  },
  accept_proposal: {
    description:
      "Applies the conversation's latest proposal, once the patient said yes to it. Can fail, for example when it expired, the appointment already started or the time was taken.",
    inputSchema: z.object({}),
  },
  hand_off: {
    description:
      "Hands the conversation to a person at the practice, who answers the patient here. Call it at most once a turn.",
    inputSchema: z.object({
      reason: z.enum([
        "patient_asked",
        "organization_cancelled",
        "rule_refused",
        "clinical",
        "emergency",
      ]),
      clinical: z.boolean().describe("True when the conversation is about health or symptoms"),
      appointmentId: z
        .string()
        .optional()
        .describe(
          "The appointment it is about, as list_patients returned it, when it is about one",
        ),
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
    "- Confirm, cancel or move an appointment, through a proposal.",
    "- Hand the conversation to a person at the practice (hand_off).",
  ];
  const rules = [
    `Every turn, call judge_messages exactly once, about the patient's new messages: clinical (symptoms, a study, a treatment, how they feel, a photo) and emergency (a risk to life or health right now). The new messages are what follows the line "${newMessagesMark}" in the patient's last message.`,
    "The number may stand for several patients. Call list_patients first. If it lists more than one patient and the patient has not said which one, ask which one before telling or doing anything about an appointment.",
    "Never state a date, time, office, address, practitioner or availability that a tool did not return.",
    "Hand off (hand_off) when: the patient asks for a person or to be contacted (patient_asked); they want a new time for an appointment the practice cancelled (organization_cancelled); a rule refuses the move they want (rule_refused); the message is clinical (clinical, clinical: true); it is an emergency (emergency, clinical: true). Pass the appointmentId when it is about one appointment. A person then answers: do not answer it yourself.",
    "When the patient answers the practice's follow-up and plainly says they are well, only thank them. Any other answer to it is for the practitioner: judge it with followUpAnswer other.",
    "When the patient asks the practice to stop writing to them, judge it with optOut true. underthing then tells them, and a person stops the messages.",
    'Changes go through propose_change, then accept_proposal: you change nothing any other way. An explicit request is its own acceptance: "sí, voy" to a reminder that asks to confirm, or "cancelalo", is proposed and accepted in the same turn. accept_proposal accepts the latest proposal only. A bare "sí" with nothing before it to answer is not a confirmation: ask what they mean.',
    '"No voy a poder" and similar are ambiguous: ask one plain question, whether to cancel or to move the appointment. Do not propose anything yet.',
    "If accept_proposal fails, say plainly that the change was not made.",
    "Free times come only from find_free_times. When the patient wants another time, including in answer to a message from the practice that moved their appointment or asks them to pick another time, call find_free_times and offer some of its times.",
    "When the patient picks a free time, propose the move and ask them to confirm it, stating the appointment, practitioner, date, time and office in full; accept it only on their yes in a later message.",
    "If accepting fails because the time was taken, say so and offer other times from find_free_times.",
    "If find_free_times or a move refuses it (past the cutoff, or the one move already used), do not offer times: tell the patient a person will contact them, and call hand_off with reason rule_refused.",
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

/**
 * What the patient is told when they ask the practice to stop writing: that
 * the team is told, since a person turns their WhatsApp consent off. Fixed,
 * so it promises nothing the model wrote.
 */
export function optOutReply(formOfAddress: FormOfAddress): string {
  return formOfAddress === "usted"
    ? "Entendido. Le avisamos al equipo para que no le enviemos más mensajes por WhatsApp."
    : "Entendido. Le avisamos al equipo para que no te enviemos más mensajes por WhatsApp.";
}

/**
 * What the patient is told when the assistant hands the conversation off:
 * that a person answers here. Fixed, so a handoff's reply says nothing the
 * model wrote.
 */
export function handoffReply(formOfAddress: FormOfAddress): string {
  return formOfAddress === "usted"
    ? "Gracias por escribirnos. Le pasamos su mensaje a una persona del equipo, que le va a responder por acá."
    : "Gracias por escribirnos. Le pasamos tu mensaje a una persona del equipo, que te va a responder por acá.";
}
