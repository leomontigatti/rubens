import * as z from "zod";

// The organization's handoff contacts (docs/domain/assistant.md § Handoff).

export const handoffContactsSchema = z.object({
  memberIds: z
    .array(z.string().min(1))
    .max(500)
    .transform((ids) => [...new Set(ids)]),
});

export type HandoffContactsInput = z.input<typeof handoffContactsSchema>;
