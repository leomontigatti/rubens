import { describe, expect, it } from "vite-plus/test";

import { answering, questionAfter, questionText } from "#/components/range-entry-question.ts";

// A time-off or closure save the server refuses for the appointments it sends
// to the "to reschedule" list asks whether to tell their patients, and the
// answer saves again with the count it was asked about.

const values = { firstDate: "2026-11-18" };

describe("the question after a save", () => {
  it("asks about the appointments the server counted", () => {
    expect(
      questionAfter(values, { ok: false, reason: "affectsAppointments", affected: 3 }),
    ).toEqual({ values, affected: 3 });
  });

  it("asks nothing once saved, or refused for another reason", () => {
    expect(questionAfter(values, { ok: true })).toBeNull();
    expect(questionAfter(values, { ok: false, reason: "notFound" })).toBeNull();
  });
});

describe("answering it", () => {
  it("saves the same values again with the answer and the count it was asked about", () => {
    expect(answering({ values, affected: 3 }, false)).toEqual({
      values,
      notice: { tellPatients: false, affected: 3 },
    });
  });
});

describe("its text", () => {
  it("names the time off or the closure and counts one appointment, or several", () => {
    expect(questionText("timeOff", 1)).toMatch(/^Esta licencia deja 1 turno fuera de horario\./);
    expect(questionText("closure", 3)).toMatch(/^Este cierre deja 3 turnos fuera de horario\./);
  });
});
