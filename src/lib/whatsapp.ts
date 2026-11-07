import * as z from "zod";

// A template sent by hand from the WhatsApp settings (#153): the recipient,
// typed the local way like any phone (`src/lib/phones.ts`), and an approved
// template with no variables, named as in Meta's template manager.

/** Meta's sample template, approved on every WhatsApp Business account. */
export const defaultTemplate = { templateName: "hello_world", languageCode: "en_US" } as const;

/** The send's fields, shared by the form and the object. */
export const templateSendSchema = z.object({
  to: z.string().trim().min(1).max(40),
  // Meta's template names: lowercase letters, digits and underscores.
  templateName: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,512}$/),
  // A language code as Meta lists them: `es`, `en_US`, `es_AR`.
  languageCode: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/),
});

export type TemplateSend = z.input<typeof templateSendSchema>;
