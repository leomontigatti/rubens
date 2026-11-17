import * as z from "zod";

import { phoneEntrySchema } from "#/lib/patients.ts";
import { parsePhoneEntry } from "#/lib/phones.ts";
import type { PhoneEntry, PhoneEntryRefusal, PhoneResult } from "#/lib/phones.ts";

// The organization's communication rules for the assistant, as the first
// release has them (#167): `vos` or `usted` and a short tone text, set by
// admins, with the phone the emergency reply gives (#176). Practitioner rules, more written rules and reply
// examples are the second release. The fixed checks every reply passes are
// not rules anyone sets: they are `src/lib/reply-checks.ts`.

/** How the assistant addresses a patient. */
export const formsOfAddress = ["vos", "usted"] as const;

export type FormOfAddress = (typeof formsOfAddress)[number];

export const maxToneLength = 300;

/** The rules' fields, shared by the form and the object. */
const communicationRulesSchema = z.object({
  formOfAddress: z.enum(formsOfAddress),
  tone: z.string().trim().max(maxToneLength),
  /** A phone field's entry; an empty number for none. */
  phone: phoneEntrySchema,
});

export type CommunicationRulesInput = z.input<typeof communicationRulesSchema>;

/** The rules as saved: the phone in E.164, or empty for none. */
type CommunicationRules = Omit<z.output<typeof communicationRulesSchema>, "phone"> & {
  phone: string;
};

/** What a refused save says: the text over its limit, or anything else wrong. */
export type CommunicationRulesRefusal = "toneTooLong" | PhoneEntryRefusal | "invalidInput";

/** The phone to save in E.164, or empty when none was typed. */
function rulesPhone(phone: PhoneEntry): PhoneResult {
  return phone.number.trim() === "" ? { ok: true, phone: "" } : parsePhoneEntry(phone);
}

/** Checks `input`, as the form or a caller sent it: the rules to save, or why they are refused. */
export function parseCommunicationRules(
  input: unknown,
): { ok: true; rules: CommunicationRules } | { ok: false; reason: CommunicationRulesRefusal } {
  const parsed = communicationRulesSchema.safeParse(input);
  if (parsed.success) {
    const typed = rulesPhone(parsed.data.phone);
    return typed.ok
      ? { ok: true, rules: { ...parsed.data, phone: typed.phone } }
      : { ok: false, reason: typed.reason };
  }
  const tooLong = (field: string) =>
    parsed.error.issues.some((issue) => issue.code === "too_big" && issue.path[0] === field);
  if (tooLong("tone")) {
    return { ok: false, reason: "toneTooLong" };
  }
  return { ok: false, reason: "invalidInput" };
}
