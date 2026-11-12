import { describe, expect, it } from "vite-plus/test";

import {
  byDay,
  conversationName,
  dayLabel,
  mediaAction,
  messageClock,
  messageSender,
  messageText,
  registeredName,
} from "#/routes/_app/conversaciones/-labels.ts";

describe("who a conversation is with", () => {
  it("names every patient the number stands for", () => {
    const patients = [
      { id: "1", name: "Martina Paz" },
      { id: "2", name: "Bruno Paz" },
    ];

    expect(conversationName({ phone: "+5493515551234", patients })).toBe("Martina Paz, Bruno Paz");
  });

  it("falls back to the number, written the local way, when it stands for no patient", () => {
    expect(conversationName({ phone: "+5493515551234", patients: [] })).toBe("0351 15-555-1234");
  });

  it("names no one in the list's contact when the number stands for no patient", () => {
    expect(registeredName({ patients: [] })).toBeNull();
    expect(registeredName({ patients: [{ id: "1", name: "Martina Paz" }] })).toBe("Martina Paz");
  });
});

describe("a message's text", () => {
  it("shows the words of a message the assistant has not judged yet", () => {
    const unjudged = {
      id: "1",
      direction: "incoming",
      sentAt: 0,
      type: "text",
      text: "me duele la muela",
      status: null,
      judgement: null,
      sentBy: null,
      media: null,
    } as const;

    expect(messageText(unjudged)).toBe("me duele la muela");
  });

  it("names a message with no words by its kind, such as a photo", () => {
    const photo = {
      id: "1",
      direction: "incoming",
      sentAt: 0,
      type: "image",
      text: null,
      status: null,
      judgement: "notForPractitioner",
      sentBy: null,
      media: null,
    } as const;

    expect(messageText(photo)).toBe("Foto");
    expect(messageText({ ...photo, type: "document" })).toBe("Archivo");
    expect(messageText({ ...photo, type: "sticker" })).toBe("Mensaje sin texto (sticker)");
  });

  it("names a file by the name the patient gave it", () => {
    const file = {
      id: "1",
      direction: "incoming",
      sentAt: 0,
      type: "document",
      text: null,
      status: null,
      judgement: "notForPractitioner",
      sentBy: null,
      media: { kind: "document", filename: "Radiografía.pdf", availableUntil: 1 },
    } as const;

    expect(messageText(file)).toBe("Archivo: Radiografía.pdf");
    expect(messageText({ ...file, media: { ...file.media, filename: null } })).toBe("Archivo");
  });

  it("marks a voice note's transcript, and says when it has none", () => {
    const voiceNote = {
      id: "1",
      direction: "incoming",
      sentAt: 0,
      type: "audio",
      text: "quiero cancelar el turno",
      status: null,
      judgement: "notForPractitioner",
      sentBy: null,
      media: null,
    } as const;

    expect(messageText(voiceNote)).toBe("Nota de voz: quiero cancelar el turno");
    expect(messageText({ ...voiceNote, text: "" })).toBe("Nota de voz que no se pudo entender");
    expect(messageText({ ...voiceNote, text: null })).toBe("Nota de voz sin transcribir");
  });
});

describe("opening a patient's media", () => {
  const availableUntil = Date.parse("2026-11-17T15:00:00Z");

  it("offers each kind of media its own button while Meta has it", () => {
    const before = availableUntil - 1;

    expect(mediaAction({ kind: "audio", filename: null, availableUntil }, before)).toBe("Escuchar");
    expect(mediaAction({ kind: "image", filename: null, availableUntil }, before)).toBe("Ver foto");
    expect(mediaAction({ kind: "video", filename: null, availableUntil }, before)).toBe(
      "Ver video",
    );
    expect(mediaAction({ kind: "document", filename: null, availableUntil }, before)).toBe(
      "Abrir archivo",
    );
  });

  it("offers none once Meta deleted it", () => {
    expect(
      mediaAction({ kind: "image", filename: null, availableUntil }, availableUntil),
    ).toBeNull();
  });
});

describe("who wrote a message", () => {
  const reply = {
    id: "1",
    direction: "outgoing",
    sentAt: 0,
    type: "text",
    text: "Hola",
    status: "sent",
    judgement: null,
    sentBy: null,
    media: null,
  } as const;

  it("names no one for the patient's own messages, which sit on their side of the chat", () => {
    expect(messageSender({ ...reply, direction: "incoming", status: null })).toBeNull();
  });

  it("names the member who replied from the inbox, and the assistant otherwise", () => {
    expect(messageSender({ ...reply, sentBy: "Rita Paz" })).toBe("Rita Paz");
    expect(messageSender(reply)).toBe("Asistente");
    expect(messageSender({ ...reply, type: "template" })).toBe("Plantilla");
  });
});

describe("the chat's days", () => {
  // Noon in Buenos Aires, where every office starts.
  const now = Date.parse("2026-11-10T15:00:00Z");

  it("names today and yesterday, and any other day by its weekday and date", () => {
    expect(dayLabel(Date.parse("2026-11-10T12:00:00Z"), now)).toBe("Hoy");
    expect(dayLabel(Date.parse("2026-11-09T12:00:00Z"), now)).toBe("Ayer");
    expect(dayLabel(Date.parse("2026-11-03T12:00:00Z"), now)).toBe("Martes 3 de noviembre");
  });

  it("adds the year to a day of another year", () => {
    expect(dayLabel(Date.parse("2025-11-03T12:00:00Z"), now)).toBe("Lunes 3 de noviembre de 2025");
  });

  it("counts days in the offices' zone, not in UTC", () => {
    // 23:00 on the 9th in Buenos Aires, already the 10th in UTC.
    expect(dayLabel(Date.parse("2026-11-10T02:00:00Z"), now)).toBe("Ayer");
    expect(messageClock(Date.parse("2026-11-10T02:00:00Z"))).toBe("23:00");
  });

  it("finds yesterday in the offices' zone when the browser's zone changes its clocks", () => {
    const browserZone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 23:30 on March 8 in Buenos Aires, hours after New York moved its clocks forward.
      const lateOnTheEighth = Date.parse("2026-03-09T02:30:00Z");

      expect(dayLabel(Date.parse("2026-03-07T15:00:00Z"), lateOnTheEighth)).toBe("Ayer");
    } finally {
      // Assigning `undefined` would store the string "undefined".
      if (browserZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = browserZone;
      }
    }
  });

  it("groups the messages by the day they were sent, keeping their order", () => {
    const sent = [
      Date.parse("2026-11-09T12:00:00Z"),
      Date.parse("2026-11-09T20:00:00Z"),
      Date.parse("2026-11-10T12:00:00Z"),
    ];

    expect(byDay(sent, (at) => at, now)).toEqual([
      { label: "Ayer", items: [sent[0], sent[1]] },
      { label: "Hoy", items: [sent[2]] },
    ]);
  });
});
