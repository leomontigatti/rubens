import * as z from "zod";

export const minPasswordLength = 8;
/** Clerk refuses a longer password. */
export const maxPasswordLength = 72;

/** The change-password input, shared by the form and the server function. */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(minPasswordLength).max(maxPasswordLength),
});
