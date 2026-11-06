import { expect, test } from "@playwright/test";
import type { Page, Request } from "@playwright/test";

import { holdServerFunctions } from "./steps.test-support.ts";
import { fullName, officeName, seededPatients, storageStateOf } from "./world.test-support.ts";

// A save that ends while the user is already somewhere else moves nobody
// (`useFormPage` in src/components/form-page.tsx). Both races need the save to
// outlast a navigation, so every server call is held for a while; the page
// load itself is not.

test.use({ storageState: storageStateOf("admin") });

// Reads are held longer than the save, so the page the user chose is still
// loading when the save ends: the window both races open in.
const held = 3_000;
const saveHeld = 1_500;
const [first, second] = seededPatients;

async function openEdit(page: Page, patient: (typeof seededPatients)[number]) {
  await page.getByRole("link", { name: fullName(patient) }).click();
  await expect(page.getByRole("heading", { level: 1, name: fullName(patient) })).toBeVisible();
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(page.getByLabel("Dirección")).toBeEditable();
}

function sidebarLink(page: Page, name: string) {
  return page.locator("[data-sidebar=menu-button]").and(page.getByRole("link", { name }));
}

/**
 * Answers the question the form asks before it is left: it is dirty while its
 * save runs. Answered before the save ends, or the spec fails here: past it,
 * the navigation would start too late to test anything.
 */
async function discardChanges(page: Page) {
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Descartar cambios" })
    .click({ timeout: saveHeld });
}

const isSave = (request: Request) =>
  request.method() === "POST" && request.url().includes("/_serverFn/");

/**
 * Changes a field to a value it never had, so the form is dirty even on a rerun
 * against the same data, then holds the server, and starts the save. Resolves as soon as
 * the save is sent, with `ended`, a promise of its end: the click itself only
 * returns once the held call does, too late to act inside the window. Wrapped,
 * since an async function returning a promise would wait for it.
 */
async function startHeldSave(page: Page, address: string) {
  await page.getByLabel("Dirección").fill(`${address} ${Date.now()}`);
  await holdServerFunctions(page, held, saveHeld);
  const sent = page.waitForRequest(isSave);
  const saved = page.waitForResponse((response) => isSave(response.request()));
  const clicked = page.getByRole("button", { name: "Guardar" }).click();
  await sent;
  return { ended: Promise.all([clicked, saved]) };
}

/** Every address the page shows from now on, client-side moves included. */
function addressesFrom(page: Page) {
  const shown: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      shown.push(new URL(frame.url()).pathname);
    }
  });
  return shown;
}

/** Waits until every held call has ended, and a little after, for a late move. */
async function settle(page: Page) {
  await page.waitForTimeout(held * 2);
  await page.waitForLoadState("networkidle");
}

// #106: before the fix, a save ending while a sidebar link's page was still
// loading sent the user back to the form, or to the list, stuck with a spinner.
// On an office's edit page, whose save leaves as soon as the server answers: a
// patient's save first reloads the page's data, and by then the link's page has
// loaded, which hides the race.
test("#106: a sidebar link clicked during a save opens its page, and stays", async ({ page }) => {
  await page.goto("/sedes");
  await page.getByRole("link", { name: officeName }).click();
  await expect(page.getByRole("heading", { level: 1, name: officeName })).toBeVisible();
  await page.getByRole("button", { name: "Editar" }).click();
  await expect(page.getByLabel("Dirección")).toBeEditable();
  const save = await startHeldSave(page, "Calle Sidebar 106");
  const shown = addressesFrom(page);
  await sidebarLink(page, "Agenda").click();
  await discardChanges(page);
  await save.ended;
  await settle(page);

  // Never back to the form or the office on the way: only the agenda.
  expect(shown.filter((pathname) => pathname !== "/agenda")).toEqual([]);
  await expect(page).toHaveURL(/\/agenda/);
  await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar" })).toHaveCount(0);
});

// #109: before the fix, a save outliving a history jump to another record's
// edit page (the same route, so the form stays mounted) moved the user off it.
test("#109: a history jump to another record's edit page during a save stays there", async ({
  page,
}) => {
  // Patient B's edit page, then patient A's reached from it by clicking, so the
  // jump back is a client navigation; with both opened by URL it would be a
  // full page load, which passes without the fix.
  await page.goto("/pacientes");
  await openEdit(page, second);
  const secondEdit = page.url();
  await sidebarLink(page, "Pacientes").click();
  await openEdit(page, first);

  const save = await startHeldSave(page, "Calle Historia 109");
  const shown = addressesFrom(page);
  await page.evaluate(() => history.go(-3));
  await discardChanges(page);
  await save.ended;
  await settle(page);

  expect(shown.filter((pathname) => pathname !== new URL(secondEdit).pathname)).toEqual([]);
  await expect(page).toHaveURL(secondEdit);
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(second.firstName);
  await expect(page.getByRole("button", { name: "Guardar" })).toBeEnabled();
});
