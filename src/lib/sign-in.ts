import * as z from "zod";

const filledSchema = z.object({ email: z.string().trim().min(1), password: z.string().min(1) });

/**
 * The sign-in form's fields, or the message for what is missing or malformed.
 * `form` is the form's data as submitted.
 */
export function readCredentials(
  form: Record<string, unknown>,
): { ok: true; credentials: { email: string; password: string } } | { ok: false; message: string } {
  const filled = filledSchema.safeParse(form);
  if (!filled.success) {
    return { ok: false, message: "Ingresá tu correo y tu contraseña." };
  }
  if (!z.email().safeParse(filled.data.email).success) {
    return { ok: false, message: "Ingresá un correo válido." };
  }
  return { ok: true, credentials: filled.data };
}

/** The sign-in form's message for a failed sign-in's HTTP status. */
export function signInErrorMessage(status: number): string {
  if (status === 401) {
    return "El correo o la contraseña no son correctos.";
  }
  // A deactivated member (src/lib/auth.ts).
  if (status === 403) {
    return "Tu cuenta está desactivada. Hablá con un administrador.";
  }
  return "No pudimos iniciar sesión. Probá de nuevo.";
}
