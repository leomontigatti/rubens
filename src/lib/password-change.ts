import * as z from "zod";

/** The change-password input, shared by the form and the server function. */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
