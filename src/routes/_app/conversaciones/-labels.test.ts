import { describe, expect, it } from "vite-plus/test";

import { conversationName, messageText } from "#/routes/_app/conversaciones/-labels.ts";

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
});

describe("a message's text", () => {
  it("names the type of a message with no words, such as a photo", () => {
    const photo = {
      id: "1",
      direction: "incoming",
      sentAt: 0,
      type: "image",
      text: null,
      status: null,
      judgement: "notClinical",
      withheld: null,
    } as const;

    expect(messageText(photo)).toBe("Mensaje sin texto (image)");
  });
});
