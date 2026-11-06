import type { Page } from "@playwright/test";

import { formatLocalDate } from "#/lib/schedules.ts";

import { medicalServiceName } from "./world.test-support.ts";

// Browser steps more than one spec takes. Locators go by role and accessible
// name; a date or a time in a name is the data the spec chose, never copy.

/**
 * Holds every server function call for `ms` before it reaches the server, as a
 * slow network would: the window the form-page and search races open in.
 * Server functions are the app's own calls (`/_serverFn/`), so a page load and
 * the browser's assets are not held.
 */
export async function holdServerFunctions(page: Page, ms: number, writesMs = ms) {
  await page.route("**/_serverFn/**", async (route) => {
    const wait = route.request().method() === "POST" ? writesMs : ms;
    await new Promise((resolve) => setTimeout(resolve, wait));
    await route.continue().catch(() => {
      // The page moved on and dropped the request: nothing to continue.
    });
  });
}

/** The calendar cell that books `date` at `time`, while it is free. */
export function freeCell(page: Page, date: string, time: string) {
  return page.getByRole("button", { name: new RegExp(`${formatLocalDate(date)}.*${time}`) });
}

/** An appointment's card on the calendar, by its start and its patient. */
export function appointmentCard(page: Page, time: string, patient: string) {
  return page.getByRole("button", { name: new RegExp(`${time}.*${patient}`) });
}

/** Opens the booking page from the free cell at `date` and `time` of the agenda. */
export async function openBooking(page: Page, date: string, time: string) {
  await page.goto(`/agenda?fecha=${date}`);
  await freeCell(page, date, time).click();
  await page.getByRole("combobox", { name: "Paciente" }).waitFor();
}

/** Picks the seeded medical service in the booking form. */
export async function selectMedicalService(page: Page) {
  const select = page.getByRole("combobox", { name: "Prestación" });
  // The option names the service and its duration; the spec knows the name.
  const option = select.getByRole("option", { name: new RegExp(medicalServiceName) });
  await select.selectOption({ label: (await option.innerText()).trim() });
}

/** Picks `patient` in the booking's patient box, and the medical service. */
export async function fillBooking(page: Page, patient: string) {
  await page.getByRole("combobox", { name: "Paciente" }).fill(patient);
  await page.getByRole("option", { name: patient }).click();
  await selectMedicalService(page);
}
