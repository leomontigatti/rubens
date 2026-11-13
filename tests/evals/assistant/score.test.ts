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

  it("passes a 👍 to the proposal, as text or as a reaction, only when it is accepted", () => {
    for (const caseId of ["thumbs-up-after-proposal", "thumbs-up-reaction-on-proposal"]) {
      const accepted = turn(caseId, "Listo, quedó el martes 17/11 a las 10:30.", (tools) => {
        tools.run("judge_messages", { healthQuestion: false, emergency: false });
        tools.run("accept_proposal", {});
      });
      const asked = turn(caseId, "Querés que lo confirme?", (tools) => {
        tools.run("judge_messages", { healthQuestion: false, emergency: false });
      });

      expect(accepted.toolChoice.pass).toBe(true);
      expect(accepted.availability.pass).toBe(true);
      expect(asked.toolChoice).toEqual({
        pass: false,
        reason: 'missing accept_proposal({"accepts":"move"})',
      });
    }
  });

  it("passes a 👍 to a reminder that asks to confirm, as text or as a reaction, only when it confirms", () => {
    for (const caseId of ["thumbs-up-reaction-on-reminder", "thumbs-up-after-reminder"]) {
      const confirmed = turn(caseId, "Listo, tu turno quedó confirmado.", (tools) => {
        tools.run("judge_messages", { healthQuestion: false, emergency: false });
        tools.run("propose_change", { kind: "confirm", appointmentId: "apt-101" });
        tools.run("accept_proposal", {});
      });
      const asked = turn(caseId, "Querés que confirme tu turno?", (tools) => {
        tools.run("judge_messages", { healthQuestion: false, emergency: false });
      });

      expect(confirmed.toolChoice.pass).toBe(true);
      expect(asked.toolChoice.reason).toBe(
        'missing propose_change({"kind":"confirm","appointmentId":"apt-101"}); missing accept_proposal({"accepts":"confirm"})',
      );
    }
  });

  it("fails confirming on a 👍 to a message that does not ask, an older reminder, or one already confirmed", () => {
    for (const caseId of [
      "thumbs-up-on-booking-confirmation",
      "thumbs-up-on-older-reminder",
      "thumbs-up-on-reminder-already-confirmed",
    ]) {
      const confirmed = turn(caseId, "Listo, tu turno quedó confirmado.", (tools) => {
        tools.run("judge_messages", { healthQuestion: false, emergency: false });
        tools.run("propose_change", { kind: "confirm", appointmentId: "apt-101" });
        tools.run("accept_proposal", {});
      });

      expect(confirmed.toolChoice.reason).toBe(
        "forbidden propose_change; forbidden accept_proposal",
      );
    }
  });

  it("fails accepting the proposal on a 👍 to an older message, or after one taken back", () => {
    for (const caseId of ["thumbs-up-on-older-message", "hesitation-after-reaction-taken-back"]) {
      const accepted = turn(caseId, "Listo, quedó el martes 17/11 a las 10:30.", (tools) => {
        tools.run("judge_messages", { healthQuestion: false, emergency: false });
        tools.run("accept_proposal", {});
      });
      const waited = turn(caseId, "Dale, cualquier cosa avisame.", (tools) => {
        tools.run("judge_messages", { healthQuestion: false, emergency: false });
      });

      expect(accepted.toolChoice).toEqual({ pass: false, reason: "forbidden accept_proposal" });
      expect(waited.toolChoice.pass).toBe(true);
      expect(waited.handoff.pass).toBe(true);
    }
  });

  it("fails a change that was accepted before it was proposed", () => {
    const result = turn("confirm-after-reminder", "Listo, confirmado.", (tools) => {
      tools.run("judge_messages", { healthQuestion: false, emergency: false });
      tools.run("accept_proposal", {});
      tools.run("propose_change", { kind: "confirm", appointmentId: "apt-101" });
    });

    expect(result.toolChoice).toEqual({
      pass: false,
      reason: 'missing accept_proposal({"accepts":"confirm"})',
    });
  });

  it("fails a confirmation proposed after a cancellation was accepted", () => {
    const result = turn("confirm-after-reminder", "Listo, confirmado.", (tools) => {
      tools.run("judge_messages", { healthQuestion: false, emergency: false });
      tools.run("propose_change", { kind: "cancel", appointmentId: "apt-101" });
      tools.run("accept_proposal", {});
      tools.run("propose_change", { kind: "confirm", appointmentId: "apt-101" });
    });

    expect(result.toolChoice).toEqual({
      pass: false,
      reason: 'missing accept_proposal({"accepts":"confirm"})',
    });
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
    // The code opens the refusal's handoff though the model called no hand_off.
    expect(refusedOnly.handoff).toEqual({ pass: true, reason: "ok" });
    expect(movedToo.handoff).toEqual({ pass: true, reason: "ok" });
  });

  it("leaves a repeat during a handoff to the practitioner to underthing's sentence", () => {
    const result = turn("repeat-during-handoff", "", (tools) => {
      tools.run("judge_messages", { healthQuestion: true, emergency: false });
    });

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

  it("tells a booking because of a toothache, reception's, from a medicine question, the dentist's", () => {
    const booking = turn("booking-for-a-toothache", "", (tools) => {
      tools.run("judge_messages", { healthQuestion: false, emergency: false });
      tools.run("hand_off", { reason: "patient_asked" });
    });
    const bookingJudgedHealth = turn("booking-for-a-toothache", "", (tools) => {
      tools.run("judge_messages", { healthQuestion: true, emergency: false });
    });
    const toDentist = turn("toothache-medicine-with-dentist", "", (tools) => {
      tools.run("judge_messages", { healthQuestion: true, emergency: false, treatedBy: "apt-103" });
    });
    const toKinesiologist = turn("toothache-medicine-with-dentist", "", (tools) => {
      tools.run("judge_messages", { healthQuestion: true, emergency: false, treatedBy: "apt-101" });
    });

    expect(booking.handoff).toEqual({ pass: true, reason: "ok" });
    expect(bookingJudgedHealth.handoff.reason).toBe(
      "handoff reason clinical; judged healthQuestion=true",
    );
    expect(toDentist.handoff).toEqual({ pass: true, reason: "ok" });
    expect(toKinesiologist.handoff.reason).toBe("judged treatedBy=apt-101");
  });

  it("tells a repeat about an open handoff to reception it opens nothing, and that underthing says it", () => {
    const result = turn("repeat-during-reception-handoff", "", (tools) => {
      tools.run("judge_messages", { healthQuestion: true, emergency: false });
      tools.run("hand_off", { reason: "clinical" });
    });
    const saidByTheModel = turn(
      "repeat-during-reception-handoff",
      "Ya se lo pasé, te va a responder por acá.",
      (tools) => tools.run("judge_messages", { healthQuestion: true, emergency: false }),
    );

    expect(result.handoff).toEqual({ pass: true, reason: "ok" });
    expect(result.reply).toEqual({ pass: true, reason: "ok" });
    expect(saidByTheModel.reply.pass).toBe(false);
  });

  it("tells a new request answered beside an open handoff from a repeat about it", () => {
    const answered = turn("new-request-during-handoff", "Es el jueves a las 16:30.", (tools) => {
      tools.run("judge_messages", { healthQuestion: false, emergency: false });
    });
    const repeated = turn("new-request-during-handoff", "Es el jueves a las 16:30.", (tools) => {
      tools.run("judge_messages", { healthQuestion: true, emergency: false });
    });

    expect(answered.handoff).toEqual({ pass: true, reason: "ok" });
    expect(repeated.handoff.reason).toBe("judged healthQuestion=true; told repeat");
  });

  it("fails a repeat about an open handoff whose reply drops the change the same turn made", () => {
    const confirmAndRepeat = (reply: string) =>
      turn("confirm-and-repeat-during-reception-handoff", reply, (tools) => {
        tools.run("judge_messages", { healthQuestion: true, emergency: false });
        tools.run("propose_change", { kind: "confirm", appointmentId: "apt-101" });
        tools.run("accept_proposal", {});
      });

    expect(confirmAndRepeat("Listo, confirmado el jueves.").handoff).toEqual({
      pass: true,
      reason: "ok",
    });
    expect(confirmAndRepeat("Listo, confirmado el jueves.").reply).toEqual({
      pass: true,
      reason: "ok",
    });
    expect(confirmAndRepeat("").reply.pass).toBe(false);
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
