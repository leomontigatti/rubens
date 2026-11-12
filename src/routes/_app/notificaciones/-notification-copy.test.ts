import { describe, expect, it } from "vite-plus/test";

import type { NotificationFacts } from "#/routes/_app/notificaciones/-notification-copy.ts";
import {
  notificationText,
  notificationTitle,
  waitingText,
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
    patient: { id: "patient-1", name: "Marta Quiroga", phone: "+5493514000001" },
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
      notificationTitle({
        ...notDelivered,
        patient: { id: "patient-1", name: "Marta Quiroga", phone: "+5493514000001" },
      }),
    ).toBe("Tu respuesta a Marta Quiroga no le llegó");
  });

  it("says the patient when the number is of no patient", () => {
    expect(notificationTitle(notDelivered)).toBe(
      "Tu respuesta de WhatsApp no le llegó al paciente",
    );
  });
});

describe("a not-delivered late reply's text", () => {
  const notDelivered: NotificationFacts = { ...facts, kind: "replyNotDelivered", handoff: null };

  it("gives the patient's phone, so they can be reached another way (#178)", () => {
    const patient = { id: "patient-1", name: "Marta Quiroga", phone: "+5493514000001" };

    expect(notificationText({ ...notDelivered, patient })).toBe(
      "La escribiste con la ventana de conversación cerrada, y no pudimos reabrirla: el paciente no respondió a tiempo la plantilla, o no se le pudo enviar. Si sigue haciendo falta, respondele cuando vuelva a escribir o contactalo por otro medio, al 0351 15-400-0001.",
    );
  });

  it("leaves the phone out for a number of no patient", () => {
    expect(notificationText(notDelivered)).toBe(
      "La escribiste con la ventana de conversación cerrada, y no pudimos reabrirla: el paciente no respondió a tiempo la plantilla, o no se le pudo enviar. Si sigue haciendo falta, respondele cuando vuelva a escribir o contactalo por otro medio.",
    );
  });
});

describe("a handoff reminder's notification", () => {
  const reminder: NotificationFacts = {
    ...withHandoff({ reason: "patientAsked", detail: null }),
    kind: "handoffReminder",
    // Thursday 12 November 2026, 19:00 UTC: 16:00 in Buenos Aires.
    until: Date.UTC(2026, 10, 12, 19, 0),
  };

  it("names the patient in its title (#177)", () => {
    expect(notificationTitle(reminder)).toBe("Marta Quiroga sigue esperando respuesta");
  });

  it("gives the reason and the fixed close time", () => {
    expect(notificationText(reminder)).toBe(
      "Pidió hablar con una persona. La ventana de WhatsApp cierra el jueves 12 de noviembre a las 16:00. Respondé antes para que tu respuesta le llegue enseguida.",
    );
  });

  it("keeps the old title for a number of no patient", () => {
    expect(
      notificationTitle({ ...reminder, handoff: { ...reminder.handoff!, patient: null } }),
    ).toBe("Una derivación de WhatsApp sigue sin respuesta");
  });
});

describe("an emergency's notification", () => {
  const emergency: NotificationFacts = { ...facts, kind: "emergency", handoff: null };

  it("names the patient", () => {
    expect(
      notificationTitle({
        ...emergency,
        patient: { id: "patient-1", name: "Marta Quiroga", phone: "+5493514000001" },
      }),
    ).toBe("Posible urgencia de Marta Quiroga en una conversación que tomaste");
    expect(notificationTitle(emergency)).toBe("Posible urgencia en una conversación que tomaste");
  });

  it("speaks of the organization's phone", () => {
    expect(notificationText(emergency)).toBe(
      "El asistente le envió al paciente el mensaje de urgencia, con el 107 y el teléfono de la organización. Respondele cuanto antes.",
    );
  });
});

describe("a restriction of the number", () => {
  const restricted: NotificationFacts = { ...facts, kind: "numberRestricted", handoff: null };

  it("says the number is what cannot start conversations (#165)", () => {
    expect(notificationText(restricted)).toBe(
      "El número no puede iniciar conversaciones hasta que Meta levante la restricción.",
    );
  });

  it("says how many messages wait only when some do", () => {
    expect(waitingText(0)).toBeNull();
    expect(waitingText(null)).toBeNull();
    expect(waitingText(1)).toBe("1 mensaje espera y sale cuando se levante.");
    expect(waitingText(3)).toBe("3 mensajes esperan y salen cuando se levante.");
  });
});

describe("a template's notification", () => {
  it("names the template without its version number (#185)", () => {
    expect(
      notificationTitle({
        ...facts,
        kind: "templateRejected",
        handoff: null,
        templateName: "Recordatorio",
        templateVersion: 2,
      }),
    ).toBe("Meta rechazó la plantilla Recordatorio");
  });
});
