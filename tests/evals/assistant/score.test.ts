import { describe, expect, it } from "vite-plus/test";

import { findCase } from "./cases.ts";
import { fakeObject } from "./fake-object.ts";
import { score, timesIn } from "./score.ts";

function turn(caseId: string, reply: string, run: (tools: ReturnType<typeof fakeObject>) => void) {
  const evaluationCase = findCase(caseId);
  const tools = fakeObject(evaluationCase);
  run(tools);
  return score(evaluationCase, { reply, calls: tools.calls, knownTimes: tools.knownTimes });
}

describe("timesIn", () => {
  it("reads the ways a reply states a clock time as minutes since midnight", () => {
    expect(timesIn("el lunes a las 9:00, el martes 10.30 o a las 17, y 18 hs")).toEqual([
      540, 630, 1080, 1020,
    ]);
  });

  it("reads half and quarter hours said in words", () => {
    expect(timesIn("el martes a las 10 y media o a las 9 y cuarto")).toEqual([630, 555]);
  });

  it("reads a time that ends a sentence", () => {
    expect(timesIn("Te queda a las 10 y media. Si no, a las 17.")).toEqual([630, 1020]);
  });

  it("ignores dates, phone numbers and the emergency number", () => {
    expect(timesIn("el 12/11, llamá al 0351 555-0100 o al 107")).toEqual([]);
  });
});

describe("score", () => {
  it("passes a move request answered with the times the tool returned", () => {
    const result = turn(
      "move-request",
      "Tengo el lunes 16/11 a las 9:00, el martes 17/11 a las 10:30 o el jueves 19/11 a las 17:00.",
      (tools) => {
        tools.run("judge_messages", { clinical: false, emergency: false });
        tools.run("find_free_times", { appointmentId: "apt-101" });
      },
    );

    expect(result.toolChoice.pass).toBe(true);
    expect(result.availability.pass).toBe(true);
    expect(result.handoff.pass).toBe(true);
  });

  it("fails a reply that offers a time no tool returned", () => {
    const result = turn("move-request", "Te puedo dar el viernes a las 11:15.", (tools) => {
      tools.run("judge_messages", { clinical: false, emergency: false });
      tools.run("find_free_times", { appointmentId: "apt-101" });
    });

    expect(result.availability).toEqual({ pass: false, reason: "times no tool returned: 11:15" });
  });

  it("fails a turn that misses a required call, uses a forbidden one or skips judging", () => {
    const result = turn("cannot-make-it", "Listo, lo cancelé.", (tools) => {
      tools.run("propose_change", { kind: "cancel", appointmentId: "apt-101" });
      tools.run("accept_proposal", {});
    });

    expect(result.toolChoice.reason).toBe(
      "forbidden propose_change; forbidden accept_proposal; judge_messages not called",
    );
    expect(result.reply.pass).toBe(false);
  });

  it("fails a change that was accepted before it was proposed", () => {
    const result = turn("confirm-after-reminder", "Listo, confirmado.", (tools) => {
      tools.run("judge_messages", { clinical: false, emergency: false });
      tools.run("accept_proposal", {});
      tools.run("propose_change", { kind: "confirm", appointmentId: "apt-101" });
    });

    expect(result.toolChoice).toEqual({ pass: false, reason: "missing accept_proposal" });
  });

  it("fails an appointment time stated before any tool returned it", () => {
    const result = turn(
      "is-it-a-bot",
      "Soy el asistente automático. Tu turno es a las 16:30.",
      (tools) => {
        tools.run("judge_messages", { clinical: false, emergency: false });
      },
    );

    expect(result.availability).toEqual({ pass: false, reason: "times no tool returned: 16:30" });
  });

  it("fails a clinical message that was not handed off as clinical", () => {
    const result = turn("symptoms", "Te paso con recepción.", (tools) => {
      tools.run("judge_messages", { clinical: false, emergency: false });
      tools.run("hand_off", { reason: "patient_asked", clinical: false });
    });

    expect(result.handoff.reason).toBe(
      "handoff clinical=false; handoff reason patient_asked; judged clinical=false",
    );
  });

  it("refuses a move past the cutoff in the fake object", () => {
    const tools = fakeObject(findCase("move-past-cutoff"));

    expect(tools.run("find_free_times", { appointmentId: "apt-101" })).toEqual({
      ok: false,
      reason: "past_cutoff",
    });
  });

  it("fails accepting a move whose time was taken meanwhile", () => {
    const tools = fakeObject(findCase("move-slot-taken"));

    expect(tools.run("accept_proposal", {})).toEqual({ ok: false, reason: "slot_taken" });
  });
});
