import * as z from "zod";

// The organization's handoff contacts, as an admin picks them in the WhatsApp
// settings: the whole set, saved at once, shared by the form and the object.

export const handoffContactsSchema = z.object({
  memberIds: z
    .array(z.string().min(1))
    .max(500)
    .transform((ids) => [...new Set(ids)]),
});

export type HandoffContactsInput = z.input<typeof handoffContactsSchema>;
