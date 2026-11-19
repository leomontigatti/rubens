import { expect, test } from "@playwright/test";

import { pickOption } from "./steps.test-support.ts";
import { fullName, people, roles, seededPatients, storageStateOf } from "./world.test-support.ts";

// The app serves, each role is signed in and reaches the agenda, and what only
// an admin may do stays out of a receptionist's reach.

for (const role of roles) {
  test.describe(`as the ${role}`, () => {
    test.use({ storageState: storageStateOf(role) });

    test("opens on the agenda", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/agenda/);
      await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
      // The account menu at the end of the top bar names who is signed in.
      await expect(
        page.locator("header").getByRole("button", { name: people[role].name }),
      ).toBeVisible();
    });
  });
}

const [patient] = seededPatients;
const patientName = fullName(patient);

test.describe("as the admin", () => {
  test.use({ storageState: storageStateOf("admin") });

  test("reaches the staff and a patient's deactivation", async ({ page }) => {
    await page.goto("/pacientes");
    await expect(page.getByRole("link", { name: "Personal" })).toBeVisible();
    await page.getByRole("link", { name: patientName }).click();
    await expect(page.getByRole("heading", { level: 1, name: patientName })).toBeVisible();
    await page.getByRole("button", { name: "Acciones" }).click();
    await expect(page.getByRole("menuitem", { name: "Archivar" })).toBeVisible();
  });
});

test.describe("as the receptionist", () => {
  test.use({ storageState: storageStateOf("receptionist") });

  test("sees no admin controls", async ({ page }) => {
    await page.goto("/pacientes");
    await page.getByRole("link", { name: patientName }).click();
    await expect(page.getByRole("heading", { level: 1, name: patientName })).toBeVisible();
    // The page is the patient's form for every member; the deactivation, in
    // `Acciones` for an admin (the test above), is absent here.
    await expect(page.getByRole("button", { name: "Guardar" })).toBeVisible();
    await page.getByRole("button", { name: "Acciones" }).click();
    await expect(page.getByRole("menuitem", { name: "Agregar cobertura" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Archivar" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Personal" })).toHaveCount(0);
  });

  test("registers a patient and finds them from the search box", async ({ page }) => {
    const firstName = "Paula";
    const lastName = "Smoke";
    await page.goto("/pacientes");
    await page.getByRole("button", { name: "Nuevo paciente" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill(firstName);
    await page.getByLabel("Apellido").fill(lastName);
    await page.getByLabel("Teléfono").fill("3514000100");
    await page.getByRole("button", { name: "Registrar paciente" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: `${firstName} ${lastName}` }),
    ).toBeVisible();

    await page.goto("/pacientes");
    await page.getByRole("textbox", { name: "Buscar paciente" }).fill("paula smo");
    const found = page.getByRole("link", { name: `${firstName} ${lastName}` });
    await expect(found).toBeVisible();
    await expect(page.getByRole("link", { name: patientName })).toHaveCount(0);
    await found.click();
    await expect(
      page.getByRole("heading", { level: 1, name: `${firstName} ${lastName}` }),
    ).toBeVisible();
  });
});

test.describe("signed out", () => {
  test("signs in on the page asked for", async ({ page }) => {
    await page.goto("/pacientes?archivados=true");
    await expect(page).toHaveURL(/\/ingresar\?volver=/);
    await pickOption(page, "Miembro", new RegExp(`^${people.receptionist.name} \\(`));
    await page.getByRole("button", { name: "Ingresar" }).click();

    await expect(page).toHaveURL(/\/pacientes\?archivados=true$/);
  });

  test("signs in on this app's start when the page asked for is another site", async ({
    page,
    baseURL,
  }) => {
    // The URL parser drops the tab: `/\t/evil.example` would be https://evil.example/.
    await page.goto("/ingresar?volver=%2F%09%2Fevil.example");
    await pickOption(page, "Miembro", new RegExp(`^${people.receptionist.name} \\(`));
    await page.getByRole("button", { name: "Ingresar" }).click();

    await expect(page).toHaveURL(new RegExp(`^${baseURL}/agenda`));
  });
});
