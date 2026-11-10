import { describe, expect, it } from "vite-plus/test";

import {
  conversationName,
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
  it("says a message the assistant has not checked yet shows once it does", () => {
    const unchecked = { id: "1", direction: "incoming", sentAt: 0, withheld: "notJudged" } as const;

    expect(messageText(unchecked)).toBe(
      "Mensaje sin revisar. Se muestra cuando el asistente lo revise.",
    );
  });

  it("names the type of a message with no words, such as a photo", () => {
    const photo = {
      id: "1",
      direction: "incoming",
      sentAt: 0,
      type: "image",
      text: null,
      status: null,
      judgement: "notClinical",
      sentBy: null,
      withheld: null,
    } as const;

    expect(messageText(photo)).toBe("Mensaje sin texto (image)");
  });

  it("marks a voice note's transcript, and says when it has none", () => {
    const voiceNote = {
      id: "1",
      direction: "incoming",
      sentAt: 0,
      type: "audio",
      text: "quiero cancelar el turno",
      status: null,
      judgement: "notClinical",
      sentBy: null,
      withheld: null,
    } as const;

    expect(messageText(voiceNote)).toBe("Nota de voz: quiero cancelar el turno");
    expect(messageText({ ...voiceNote, text: "" })).toBe("Nota de voz que no se pudo entender");
    expect(messageText({ ...voiceNote, text: null })).toBe("Nota de voz sin transcribir");
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
    withheld: null,
  } as const;

  it("names no one for the patient's own messages, which sit on their side of the chat", () => {
    expect(messageSender({ ...reply, direction: "incoming", status: null })).toBeNull();
  });

  it("names the member who replied from the inbox, and the assistant otherwise", () => {
    expect(messageSender({ ...reply, sentBy: "Rita Paz" })).toBe("Rita Paz");
    expect(messageSender(reply)).toBe("Asistente");
    expect(messageSender({ ...reply, type: "template" })).toBe("Plantilla");
  });

  it("names no one for a practitioner's reply withheld from the reader", () => {
    expect(messageSender({ id: "1", direction: "outgoing", sentAt: 0, withheld: "clinical" })).toBe(
      "Profesional",
    );
  });
});
