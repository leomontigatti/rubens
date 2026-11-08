import * as z from "zod";

export const minPasswordLength = 8;
/** Clerk refuses a longer password. It counts UTF-8 bytes: "ñ" takes two, an emoji four. */
const maxPasswordBytes = 72;

/** Whether a password fits Clerk's limit, counted in UTF-8 bytes. */
export function fitsMaxPasswordBytes(password: string) {
  return new TextEncoder().encode(password).length <= maxPasswordBytes;
}

/** The change-password input, shared by the form and the server function. */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(minPasswordLength).refine(fitsMaxPasswordBytes),
});
