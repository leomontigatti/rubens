import { expect, test } from "@playwright/test";

import { people, seededIncomingMessages, storageStateOf } from "./world.test-support.ts";

// Taking a conversation over from the inbox as reception walks it: take over
// the unknown number's conversation, which has no handoff, reply to it under
// one's name, and give it back to the assistant. Meta is answered inside the
// Worker (`src/dev/fake-meta.ts`); this spec alone changes a conversation.

test.use({ storageState: storageStateOf("receptionist") });

const unknownNumber = seededIncomingMessages.at(-1)!.from;

test("takes a conversation over, replies under one's name, and gives it back", async ({ page }) => {
  await page.goto("/conversaciones");
  // The number as the inbox writes it, such as `0351 15-499-9999`.
  const lastDigits = unknownNumber.replace(/\D/gu, "").slice(-4);
  await page.getByRole("link", { name: new RegExp(lastDigits, "u") }).click();

  await page.getByRole("button", { name: "Tomar conversación" }).click();
  await expect(page.getByRole("button", { name: "Devolver al asistente" })).toBeVisible();

  const reply = "Hola, te escribo desde recepción por tu consulta.";
  await page.getByLabel("Respuesta").fill(reply);
  await page.getByRole("button", { name: "Enviar" }).click();

  const sent = page.getByRole("listitem").filter({ hasText: reply });
  await expect(sent).toBeVisible();
  await expect(sent).toContainText(people.receptionist.name);
  await expect(page.getByLabel("Respuesta")).toHaveValue("");

  await page.getByRole("button", { name: "Devolver al asistente" }).click();
  await expect(page.getByRole("button", { name: "Tomar conversación" })).toBeVisible();
  await expect(page.getByLabel("Respuesta")).toHaveCount(0);
});
