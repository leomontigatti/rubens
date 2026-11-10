import { describe, expect, it } from "vite-plus/test";

import { proposalState, proposalStatement, windowCountdown } from "#/lib/assistant-sandbox-copy.ts";

describe("the sandbox's window countdown", () => {
  const closesAt = Date.UTC(2099, 0, 2, 12);

  it("rounds what is left up to the minute, so it never reads 0 min while the window is open", () => {
    expect(windowCountdown(closesAt, closesAt - 30_000)).toBe("Cierra en 0 h 01 min");
    expect(windowCountdown(closesAt, closesAt - 24 * 60 * 60_000)).toBe("Cierra en 24 h 00 min");
    expect(windowCountdown(closesAt, closesAt - (5 * 60 + 7) * 60_000)).toBe(
      "Cierra en 5 h 07 min",
    );
  });

  it("reads closed from the close on", () => {
    expect(windowCountdown(closesAt, closesAt)).toBe("Cerrada");
  });

  it("reads unopened before the patient writes", () => {
    expect(windowCountdown(null, closesAt)).toBe("Sin abrir: el paciente todavía no escribió.");
  });
});

describe("a sandbox proposal's state", () => {
  const expiresAt = Date.UTC(2099, 0, 1, 13);

  it("counts down to its expiry while it waits, and reads expired from then on", () => {
    expect(proposalState({ acceptedAt: null, expiresAt }, expiresAt - 60 * 60_000)).toEqual({
      label: "Vence en 1 h 00 min",
      variant: "outline",
    });
    expect(proposalState({ acceptedAt: null, expiresAt }, expiresAt).label).toBe("Vencida");
  });

  it("reads accepted once accepted, though its expiry passed", () => {
    expect(proposalState({ acceptedAt: expiresAt - 1, expiresAt }, expiresAt + 1).label).toBe(
      "Aceptada",
    );
  });
});

describe("a sandbox proposal's statement", () => {
  const appointment = {
    kind: "move",
    medicalService: "Consulta",
    practitioner: "Juan Gómez",
    date: "lunes 5 de enero",
    time: "09:00",
    office: "Sede Centro",
  };

  it("states a move's new time after the appointment it moves", () => {
    expect(
      proposalStatement({ ...appointment, newDate: "lunes 12 de enero", newTime: "10:00" }),
    ).toBe(
      "Consulta con Juan Gómez, lunes 5 de enero a las 09:00, al lunes 12 de enero a las 10:00",
    );
  });

  it("states only the appointment for a cancel or a confirmation", () => {
    expect(proposalStatement({ ...appointment, kind: "cancel" })).toBe(
      "Consulta con Juan Gómez, lunes 5 de enero a las 09:00",
    );
  });
});
