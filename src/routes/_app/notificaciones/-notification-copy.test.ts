import { describe, expect, it } from "vite-plus/test";

import type { NotificationFacts } from "#/routes/_app/notificaciones/-notification-copy.ts";
import { notificationText } from "#/routes/_app/notificaciones/-notification-copy.ts";

const facts: NotificationFacts = {
  kind: "handoff",
  templateName: null,
  templateVersion: null,
  detail: null,
  until: null,
  waiting: null,
  patient: null,
  handoff: {
    conversationId: "conversation-1",
    reason: "ruleRefused",
    forPractitioner: false,
    noPractitioner: false,
    patient: "Marta Quiroga",
    detail: {
      refused: {
        why: "pastCutoff",
        cutoffHours: 24,
        date: "jueves 12 de noviembre",
        time: "10:00",
      },
      applied: [],
    },
  },
};

function withHandoff(handoff: Partial<NonNullable<NotificationFacts["handoff"]>>) {
  return { ...facts, handoff: { ...facts.handoff!, ...handoff } };
}

describe("a handoff's notification", () => {
  it("says why a move was refused, so reception answers without reading the conversation", () => {
    expect(notificationText(facts)).toBe(
      "Marta Quiroga quiere pasar el turno del jueves 12 de noviembre 10:00 y falta menos de 24 h.",
    );
  });

  it("names the patient's second move as the one refused", () => {
    const refused = { ...facts.handoff!.detail!.refused!, why: "moveUsed" as const };

    expect(notificationText(withHandoff({ detail: { refused, applied: [] } }))).toBe(
      "Marta Quiroga quiere pasar el turno del jueves 12 de noviembre 10:00, que ya movió una vez.",
    );
  });

  it("names a change the same turn made beside the refusal (#237)", () => {
    const applied = [
      {
        kind: "move" as const,
        date: "martes 10 de noviembre",
        time: "09:00",
        newDate: "viernes 13 de noviembre",
        newTime: "10:00",
      },
    ];

    expect(
      notificationText(
        withHandoff({ detail: { refused: facts.handoff!.detail!.refused, applied } }),
      ),
    ).toBe(
      "Marta Quiroga quiere pasar el turno del jueves 12 de noviembre 10:00 y falta menos de 24 h. El asistente ya le pasó el turno del martes 10 de noviembre 09:00 al viernes 13 de noviembre 10:00.",
    );
  });

  it("names the reason and the patient for any other handoff", () => {
    expect(notificationText(withHandoff({ reason: "media", detail: null }))).toBe(
      "Mandó una foto, un video o un archivo: Marta Quiroga.",
    );
  });

  it("tells an admin who got one for the practitioner that nobody keeps clinical records", () => {
    expect(
      notificationText(
        withHandoff({
          reason: "clinical",
          forPractitioner: true,
          noPractitioner: true,
          detail: null,
        }),
      ),
    ).toBe(
      "Consulta para el profesional: Marta Quiroga. Te llegó porque ningún profesional activo lleva historias clínicas: elegí los contactos de derivación para que la reciba uno.",
    );
  });
});
