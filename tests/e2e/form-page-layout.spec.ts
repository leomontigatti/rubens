import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { storageStateOf } from "./world.test-support.ts";

// `FormPage`'s action bar fits a phone with every button it can show: an edited
// template has `Volver`, `Descartar cambios` and the longest submit label the
// app has. Below `sm` the submit takes a row of its own; from `sm` up the three
// share one row.

test.use({ storageState: storageStateOf("admin") });

/** Opens a template's page and changes its text, without saving. */
async function editTemplate(page: Page) {
  await page.goto("/whatsapp/plantillas");
  await page.getByRole("link", { name: "Recordatorio", exact: true }).click();
  const text = page.getByRole("textbox", { name: "Texto" });
  await expect(text).toBeEditable();
  await text.press("End");
  await text.pressSequentially(" Saludos.");
  const form = page.locator("form");
  return {
    back: form.getByRole("button", { name: "Volver" }),
    discard: form.getByRole("button", { name: "Descartar cambios" }),
    submit: form.getByRole("button", { name: "Guardar y enviar a Meta" }),
  };
}

async function boxOf(button: Locator) {
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  if (!box) {
    throw new Error("The button has no box");
  }
  return box;
}

test("fits the action bar at 390 px, the submit on a row of its own", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { back, discard, submit } = await editTemplate(page);
  const [backBox, discardBox, submitBox] = await Promise.all([
    boxOf(back),
    boxOf(discard),
    boxOf(submit),
  ]);
  for (const box of [backBox, discardBox, submitBox]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  expect(discardBox.y).toBe(backBox.y);
  expect(submitBox.y).toBeGreaterThan(backBox.y + backBox.height);
  expect(submitBox.x).toBe(backBox.x);
  expect(submitBox.x + submitBox.width).toBe(discardBox.x + discardBox.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test("keeps the action bar on one row at 1440 px", async ({ page }) => {
  const { back, discard, submit } = await editTemplate(page);
  const [backBox, discardBox, submitBox] = await Promise.all([
    boxOf(back),
    boxOf(discard),
    boxOf(submit),
  ]);
  expect(discardBox.y).toBe(backBox.y);
  expect(submitBox.y).toBe(backBox.y);
  expect(discardBox.x + discardBox.width).toBeLessThan(submitBox.x);
});
