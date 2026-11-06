import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

import {
  appointmentCard,
  fillBooking,
  freeCell,
  openBooking,
  selectMedicalService,
} from "./steps.ts";
import { nextWeek, people, storageStateOf } from "./world.ts";

// The booking path as reception walks it: book from the calendar, have a second
// booking of the same start refused, and move an appointment a time off left
// outside working time. Each test keeps to its own weekday of next week.

test.use({ storageState: storageStateOf("receptionist") });

async function registerFromPicker(page: Page, firstName: string, lastName: string, phone: string) {
  await page.getByRole("button", { name: "Registrar paciente nuevo" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill(firstName);
  await page.getByLabel("Apellido").fill(lastName);
  await page.getByLabel("Teléfono").fill(phone);
  await page.getByRole("button", { name: "Registrar paciente" }).click();
  await expect(page.getByRole("combobox", { name: "Paciente" })).toHaveValue(
    `${firstName} ${lastName}`,
  );
}

/** Books `patient` at `date` and `time` and waits for the calendar to show it. */
async function book(page: Page, date: string, time: string, patient: string) {
  await openBooking(page, date, time);
  await fillBooking(page, patient);
  await page.getByRole("button", { name: "Dar turno" }).click();
  await expect(appointmentCard(page, time, patient)).toBeVisible();
}

async function pageAs(browser: Browser, role: "admin" | "receptionist") {
  const context = await browser.newContext({ storageState: storageStateOf(role) });
  return context.newPage();
}

test("books a new patient from the agenda and shows them on the calendar", async ({ page }) => {
  const date = nextWeek(1);
  await openBooking(page, date, "09:00");
  await registerFromPicker(page, "Bruno", "Agenda", "0351 15 400-0201");
  await selectMedicalService(page);
  await page.getByRole("button", { name: "Dar turno" }).click();

  await expect(page).toHaveURL(new RegExp(`/agenda\\?fecha=${date}`));
  await expect(appointmentCard(page, "09:00", "Bruno Agenda")).toBeVisible();
  // The start is taken: its cell no longer offers a booking.
  await expect(freeCell(page, date, "09:00")).toHaveCount(0);
});

test("refuses a second booking of the practitioner's same start, saving nothing", async ({
  page,
  browser,
}) => {
  const date = nextWeek(2);
  const first = "Carla Doble";
  const second = "Diego Doble";
  for (const [name, phone] of [
    [first, "0351 15 400-0301"],
    [second, "0351 15 400-0302"],
  ] as const) {
    await openBooking(page, date, "09:00");
    const [firstName, lastName] = name.split(" ") as [string, string];
    await registerFromPicker(page, firstName, lastName, phone);
    await page.goto(`/agenda?fecha=${date}`);
  }

  // Two receptionists open the same free start; the other one books it first.
  await openBooking(page, date, "09:00");
  await fillBooking(page, second);
  const other = await pageAs(browser, "receptionist");
  await book(other, date, "09:00", first);

  await page.getByRole("button", { name: "Dar turno" }).click();
  // The form stays, with the problem on the start it asked for.
  const start = page.getByRole("group", { name: "Horario" });
  await expect(start).toHaveAttribute("aria-invalid", "true");
  await expect(start).toHaveAccessibleDescription(/\S/);
  await expect(page).toHaveURL(/\/agenda\/turnos\/nuevo/);

  await page.goto(`/agenda?fecha=${date}`);
  await expect(appointmentCard(page, "09:00", first)).toBeVisible();
  await expect(appointmentCard(page, "09:00", second)).toHaveCount(0);
  await other.context().close();
});

test("moves an appointment a time off left outside working time", async ({ page, browser }) => {
  const date = nextWeek(3);
  const moveTo = nextWeek(4);
  const patient = "Elena Licencia";
  await openBooking(page, date, "10:00");
  await registerFromPicker(page, "Elena", "Licencia", "0351 15 400-0401");
  await selectMedicalService(page);
  await page.getByRole("button", { name: "Dar turno" }).click();
  await expect(appointmentCard(page, "10:00", patient)).toBeVisible();

  // The admin adds a time off over the practitioner's whole day.
  const admin = await pageAs(browser, "admin");
  await admin.goto("/licencias/nueva");
  await admin
    .getByRole("combobox", { name: "Profesional" })
    .selectOption({ label: people.practitioner.name });
  await admin.getByLabel("Desde").fill(date);
  await admin.getByLabel("Hasta (inclusive)").fill(date);
  await admin.getByRole("button", { name: "Crear licencia" }).click();
  await expect(admin).toHaveURL(/\/licencias$/);
  await admin.context().close();

  await page.goto("/a-reprogramar");
  const listed = page.getByRole("listitem").filter({ hasText: patient });
  await expect(listed).toBeVisible();
  await listed.getByRole("button", { name: "Reprogramar" }).click();

  await page.getByLabel("Horarios libres desde").fill(moveTo);
  await page
    .getByRole("group", { name: "Horario" })
    .getByRole("button", { name: "10:00" })
    .first()
    .click();
  await page.getByRole("button", { name: "Reprogramar" }).click();
  await expect(page).not.toHaveURL(/\/turnos\/.+\/reprogramar/);

  await page.goto("/a-reprogramar");
  await expect(page.getByRole("listitem").filter({ hasText: patient })).toHaveCount(0);
  await page.goto(`/agenda?fecha=${moveTo}`);
  await expect(appointmentCard(page, "10:00", patient)).toBeVisible();
  await expect(freeCell(page, moveTo, "10:00")).toHaveCount(0);
});
