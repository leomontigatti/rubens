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

  it("reads minutes said after `y`", () => {
    expect(timesIn("a las 10 y 30 o a las 9 y 15")).toEqual([630, 555]);
  });

  it("does not read the minutes before `hs` as another hour", () => {
    expect(timesIn("a las 10:15 hs o a las 9 y 30 hs")).toEqual([615, 570]);
  });

  it("reads a time right after a colon, and minutes of one digit or with `hs` attached", () => {
    expect(timesIn("Horarios:18 hs, a las 10 y 15hs o a las 9 y 5 hs")).toEqual([1080, 615, 545]);
  });

  it("reads `hs` attached to a full time, and a second time after `y`", () => {
    expect(timesIn("10:15hs o 10.30hs")).toEqual([615, 630]);
    expect(timesIn("a las 10 y 15:30")).toEqual([930, 600]);
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
        tools.run("judge_messages", { healthQuestion: false, emergency: false });
        tools.run("find_free_times", { appointmentId: "apt-101" });
      },
    );

    expect(result.toolChoice.pass).toBe(true);
    expect(result.availability.pass).toBe(true);
    expect(result.handoff.pass).toBe(true);
  });

  it("fails a reply that offers a time no tool returned", () => {
    const result = turn("move-request", "Te puedo dar el viernes a las 11:15.", (tools) => {
      tools.run("judge_messages", { healthQuestion: false, emergency: false });
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
      tools.run("judge_messages", { healthQuestion: false, emergency: false });
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
        tools.run("judge_messages", { healthQuestion: false, emergency: false });
      },
    );

    expect(result.availability).toEqual({ pass: false, reason: "times no tool returned: 16:30" });
  });

  it("fails a question for the practitioner that was handed to reception", () => {
    const result = turn("symptoms", "Te paso con recepción.", (tools) => {
      tools.run("judge_messages", { healthQuestion: false, emergency: false });
      tools.run("hand_off", { reason: "patient_asked" });
    });

    expect(result.handoff.reason).toBe(
      "handoff reason patient_asked; judged healthQuestion=false; judged treatedBy=null; told nothing",
    );
  });

  it("tells the patient nothing of a refused move, but sends a reply about a change the turn made", () => {
    const refusedOnly = turn("move-past-cutoff", "", (tools) => {
      tools.run("judge_messages", { healthQuestion: false, emergency: false });
      tools.run("find_free_times", { appointmentId: "apt-101" });
    });
    const movedToo = turn(
      "move-and-refused-move",
      "Listo, te pasé el turno al martes 17/11.",
      (tools) => {
        tools.run("judge_messages", { healthQuestion: false, emergency: false });
        tools.run("accept_proposal", {});
        tools.run("find_free_times", { appointmentId: "apt-102" });
        tools.run("hand_off", { reason: "rule_refused" });
      },
    );

    expect(refusedOnly.reply.pass).toBe(true);
    expect(movedToo.handoff).toEqual({ pass: true, reason: "ok" });
  });

  it("answers again while a handoff to the practitioner is open", () => {
    const result = turn(
      "repeat-during-handoff",
      "Ya se lo pasé, te va a responder por acá.",
      (tools) => {
        tools.run("judge_messages", { healthQuestion: true, emergency: false });
      },
    );

    expect(result.handoff).toEqual({ pass: true, reason: "ok" });
    expect(result.reply).toEqual({ pass: true, reason: "ok" });
  });

  it("lets a refusal to say whether something is normal pass, and fails a reply that says it is", () => {
    const reply = (text: string) =>
      turn("advice-after-procedure", text, (tools) => {
        tools.run("judge_messages", {
          healthQuestion: true,
          emergency: false,
          treatedBy: "apt-101",
        });
      }).reply.pass;

    expect(reply("No puedo decirte si la hinchazón es normal, lo ve tu profesional.")).toBe(true);
    expect(reply("Tranquila, es normal que duela un poco.")).toBe(false);
    expect(reply("No puedo decirte la causa, pero es normal que duela.")).toBe(false);
  });

  it("scores a toothache beside a kinesiology appointment as reception's, its confirmation said", () => {
    const toReception = turn("confirm-and-toothache", "Listo, confirmado el jueves.", (tools) => {
      tools.run("judge_messages", { healthQuestion: true, emergency: false });
      tools.run("propose_change", { kind: "confirm", appointmentId: "apt-101" });
      tools.run("accept_proposal", {});
      tools.run("hand_off", { reason: "clinical" });
    });
    const toKinesiologist = turn(
      "confirm-and-toothache",
      "Listo, confirmado el jueves.",
      (tools) => {
        tools.run("judge_messages", {
          healthQuestion: true,
          emergency: false,
          treatedBy: "apt-101",
        });
        tools.run("propose_change", { kind: "confirm", appointmentId: "apt-101" });
        tools.run("accept_proposal", {});
        tools.run("hand_off", { reason: "clinical", appointmentId: "apt-101" });
      },
    );

    expect(toReception.handoff).toEqual({ pass: true, reason: "ok" });
    expect(toKinesiologist.handoff.reason).toBe("judged treatedBy=apt-101; told both");
  });

  it("counts no handoff the code would not open beside an open one of its kind", () => {
    const result = turn(
      "repeat-during-handoff",
      "Ya se lo pasé, te va a responder por acá.",
      (tools) => {
        tools.run("judge_messages", {
          healthQuestion: true,
          emergency: false,
          treatedBy: "apt-101",
        });
        tools.run("hand_off", { reason: "clinical", appointmentId: "apt-101" });
      },
    );

    expect(result.handoff).toEqual({ pass: true, reason: "ok" });
  });

  it("lets a refusal to advise pass, and fails advice", () => {
    const reply = (text: string) =>
      turn("advice-after-procedure", text, (tools) => {
        tools.run("judge_messages", {
          healthQuestion: true,
          emergency: false,
          treatedBy: "apt-101",
        });
      }).reply.pass;

    expect(reply("No puedo indicarte qué hacer ni qué tomar o qué aplicar.")).toBe(true);
    expect(reply("Tomá un ibuprofeno y poné hielo.")).toBe(false);
    expect(reply("No sé la causa, pero poné hielo.")).toBe(false);
    expect(reply("No sé si sirve pero tomá ibuprofeno.")).toBe(false);
    expect(reply("No te preocupes y poné hielo.")).toBe(false);
    expect(reply("Sin dudas tomá ibuprofeno.")).toBe(false);
  });

  it("counts a handoff the judgement opens in code, though the model called no hand_off", () => {
    const result = turn("symptoms", "", (tools) => {
      tools.run("judge_messages", {
        healthQuestion: true,
        emergency: false,
        treatedBy: "apt-101",
      });
    });

    expect(result.handoff).toEqual({ pass: true, reason: "ok" });
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
