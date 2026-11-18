import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { appointmentCard, fillBooking, openBooking } from "./steps.test-support.ts";
import { fullName, nextWeek, seededPatients, storageStateOf } from "./world.test-support.ts";

// Where focus goes when a filter is added or removed and when a form refuses
// what was sent, and the question before leaving a form with unsaved changes:
// what a keyboard or screen reader user follows, and what keeps an edit from
// being lost.

test.use({ storageState: storageStateOf("admin") });

const patient = seededPatients.at(-1)!;

async function openAgenda(page: Page) {
  await page.goto("/agenda");
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
}

const addFilter = (page: Page) => page.getByRole("button", { name: "Agregar filtro" });

/** Applies the first value of the filter `label`, from the add-filter popover. */
async function applyFirst(page: Page, label: string) {
  await addFilter(page).click();
  await page.getByRole("dialog").getByRole("button", { name: label }).click();
  const values = page.getByRole("dialog").getByRole("button");
  // The first value, past the button back to the groups.
  const first = values.nth(1);
  await expect(first).toBeFocused();
  await first.click();
  await expect(page.getByRole("group", { name: new RegExp(`^${label}: `) })).toBeVisible();
}

test.describe("the filter bar", () => {
  test("focuses a short list's first value, and the add button once a filter is removed", async ({
    page,
  }) => {
    await openAgenda(page);
    await applyFirst(page, "Profesional");
    await page.getByRole("button", { name: "Quitar filtro Profesional" }).click();
    await expect(page.getByRole("group", { name: /^Profesional: / })).toHaveCount(0);
    await expect(addFilter(page)).toBeFocused();
  });

  test("focuses the add button when the removed filter brings it back", async ({ page }) => {
    await openAgenda(page);
    await applyFirst(page, "Profesional");
    await applyFirst(page, "Prestación");
    // Every filter is applied, so there is nothing left to add.
    await expect(addFilter(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Quitar filtro Prestación" }).click();
    await expect(addFilter(page)).toBeFocused();
  });
});

async function openEdit(page: Page) {
  await page.goto("/pacientes");
  await page.getByRole("link", { name: fullName(patient) }).click();
  await expect(page.getByRole("heading", { level: 1, name: fullName(patient) })).toBeVisible();
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(page.getByLabel("Dirección")).toBeEditable();
}

test.describe("a form page", () => {
  test("offers to discard only while something differs, and asks before leaving", async ({
    page,
  }) => {
    await openEdit(page);
    const address = page.getByLabel("Dirección");
    const discard = page.getByRole("button", { name: "Descartar cambios" });
    const saved = await address.inputValue();
    await expect(discard).toHaveCount(0);

    await address.fill(`${saved} 2`);
    await expect(discard).toBeVisible();
    await address.fill(saved);
    await expect(discard).toHaveCount(0);

    await address.fill(`${saved} 3`);
    await page
      .locator("[data-sidebar=menu-button]")
      .and(page.getByRole("link", { name: "Pacientes" }))
      .click();
    const question = page.getByRole("alertdialog");
    await question.getByRole("button", { name: "Seguir editando" }).click();
    await expect(address).toHaveValue(`${saved} 3`);
    await expect(page).toHaveURL(/\/editar$/);
  });

  test("focuses the first refused field", async ({ page }) => {
    await openEdit(page);
    await page.getByLabel("Nombre", { exact: true }).fill("");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByLabel("Nombre", { exact: true })).toBeFocused();
  });
});

test("the booking's quick registration focuses the first refused field", async ({ page }) => {
  await openBooking(page, nextWeek(4), "11:30");
  await page.getByRole("button", { name: "Registrar paciente nuevo" }).click();
  await page.getByRole("button", { name: "Registrar paciente" }).click();
  await expect(page.getByLabel("Nombre", { exact: true })).toBeFocused();
});

test("the assistant's sandbox focuses a refused message", async ({ page }) => {
  // The sandbox starts from an upcoming appointment: this spec books its own.
  await openBooking(page, nextWeek(3), "12:00");
  await fillBooking(page, fullName(patient));
  await page.getByRole("button", { name: "Dar turno" }).click();
  await expect(appointmentCard(page, "12:00", fullName(patient))).toBeVisible();

  await page.goto("/whatsapp/configuracion/prueba");
  await page.getByRole("button", { name: "Empezar" }).click();
  const message = page.getByLabel("Mensaje del paciente");
  await expect(message).toBeVisible();
  await page.getByRole("button", { name: "Enviar como el paciente" }).click();
  await expect(message).toBeFocused();
});
