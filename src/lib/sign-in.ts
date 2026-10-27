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
