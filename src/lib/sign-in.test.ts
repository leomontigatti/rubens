import { describe, expect, it } from "vite-plus/test";

import { readCredentials } from "#/lib/sign-in.ts";

describe("readCredentials", () => {
  it("trims the email and keeps the password as typed", () => {
    expect(readCredentials({ email: " ana@prueba.test ", password: " clave " })).toEqual({
      ok: true,
      credentials: { email: "ana@prueba.test", password: " clave " },
    });
  });

  it.each([
    [{ email: "", password: "" }],
    [{ email: "ana@prueba.test", password: "" }],
    [{ email: "  ", password: "clave" }],
    [{}],
  ])("asks for both fields when one is empty: %o", (form) => {
    expect(readCredentials(form)).toEqual({
      ok: false,
      message: "Ingresá tu correo y tu contraseña.",
    });
  });

  // The browser's type=email check no longer runs (noValidate), and Better Auth
  // answers a malformed email with a 400 the screen reads as "try again".
  it("refuses an email with no @ before it reaches the server", () => {
    expect(readCredentials({ email: "ana.gomez", password: "clave" })).toEqual({
      ok: false,
      message: "Ingresá un correo válido.",
    });
  });
});
