import { describe, expect, it } from "vite-plus/test";

import { isStillOn } from "#/components/form-page-location.ts";

const at = (pathname: string) => ({ pathname });

describe("isStillOn", () => {
  it("is true while the router has stayed on the page the save started on", () => {
    expect(
      isStillOn("/pacientes/a/editar", at("/pacientes/a/editar"), at("/pacientes/a/editar")),
    ).toBe(true);
  });

  it("is true before the router has resolved any location", () => {
    expect(isStillOn("/sedes/nueva", at("/sedes/nueva"), undefined)).toBe(true);
  });

  it("is false once the user reached another record of the same edit page", () => {
    expect(
      isStillOn("/pacientes/a/editar", at("/pacientes/b/editar"), at("/pacientes/b/editar")),
    ).toBe(false);
  });

  it("is false while a navigation away is still loading", () => {
    expect(isStillOn("/sedes/nueva", at("/personal"), at("/sedes/nueva"))).toBe(false);
  });

  it("is false while a navigation back to the page is loading from another record", () => {
    expect(
      isStillOn("/pacientes/a/editar", at("/pacientes/a/editar"), at("/pacientes/b/editar")),
    ).toBe(false);
  });
});
