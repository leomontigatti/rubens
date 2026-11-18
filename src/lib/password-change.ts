import * as z from "zod";

export const minPasswordLength = 8;
/** Clerk refuses a longer password. It counts UTF-8 bytes: "ñ" takes two, an emoji four. */
const maxPasswordBytes = 72;

export function fitsMaxPasswordBytes(password: string) {
  return new TextEncoder().encode(password).length <= maxPasswordBytes;
}

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(minPasswordLength).refine(fitsMaxPasswordBytes),
});
