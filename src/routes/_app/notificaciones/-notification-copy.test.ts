import { describe, expect, it } from "vite-plus/test";

import type { NotificationFacts } from "#/routes/_app/notificaciones/-notification-copy.ts";
import {
  notificationText,
  notificationTitle,
} from "#/routes/_app/notificaciones/-notification-copy.ts";

const facts: NotificationFacts = {
  kind: "handoff",
  templateName: null,
  templateVersion: null,
  detail: null,
  until: null,
  waiting: null,
  patient: null,
  appointment: null,
  messageId: null,
  resolved: false,
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
    const media = { refused: null, applied: [], media: ["image" as const] };

    expect(notificationText(withHandoff({ reason: "media", detail: media }))).toBe(
      "Mandó una foto: Marta Quiroga.",
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

describe("a cancellation's notification", () => {
  it("names the patient, the day and time in the office's zone, and the practitioner", () => {
    const cancelled: NotificationFacts = {
      ...facts,
      kind: "appointmentCancelled",
      handoff: null,
      appointment: {
        patient: "Marta Quiroga",
        practitioner: "Juan Prueba",
        // Thursday 12 November 2026, 13:00 UTC: 10:00 in Buenos Aires.
        startsAt: Date.UTC(2026, 10, 12, 13, 0),
        timeZone: "America/Argentina/Buenos_Aires",
      },
    };

    expect(notificationTitle(cancelled)).toBe(
      "Marta Quiroga canceló su turno del jueves 12/11 10:00 con Juan Prueba",
    );
  });
});

describe("an opt-out's notification", () => {
  const optOut: NotificationFacts = {
    ...facts,
    kind: "optOut",
    handoff: null,
    patient: { id: "patient-1", name: "Marta Quiroga" },
    messageId: "message-1",
  };

  it("sends the reader to decide under the patient's message", () => {
    expect(notificationText(optOut)).toBe(
      "Sus recordatorios y avisos quedan en espera hasta que alguien decida, debajo de su mensaje en la conversación: Dejar de enviar o Seguir enviando.",
    );
  });

  it("says it was decided, once someone did", () => {
    expect(notificationText({ ...optOut, kind: "optOutReminder", resolved: true })).toBe(
      "Ya se decidió: lo ves debajo de su mensaje en la conversación.",
    );
  });

  it("sends the reader to the record for an opt-out no message is kept for", () => {
    expect(notificationText({ ...optOut, messageId: null })).toBe(
      "Sus recordatorios y avisos quedan en espera hasta que decidas en su ficha: Dejar de enviar por WhatsApp, o Seguir enviando.",
    );
    expect(notificationText({ ...optOut, messageId: null, resolved: true })).toBe(
      "Ya se decidió en su ficha.",
    );
  });
});

describe("a not-delivered late reply's notification", () => {
  const notDelivered: NotificationFacts = { ...facts, kind: "replyNotDelivered", handoff: null };

  it("names the patient it was for", () => {
    expect(
      notificationTitle({ ...notDelivered, patient: { id: "patient-1", name: "Marta Quiroga" } }),
    ).toBe("Tu respuesta a Marta Quiroga no le llegó");
  });

  it("says the patient when the number is of no patient", () => {
    expect(notificationTitle(notDelivered)).toBe(
      "Tu respuesta de WhatsApp no le llegó al paciente",
    );
  });
});
