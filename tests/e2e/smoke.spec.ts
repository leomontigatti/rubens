import { expect, test } from "@playwright/test";

import { people, roles, seededPatients, storageStateOf } from "./world.ts";

// The app serves, each role is signed in and reaches the agenda, and what only
// an admin may do stays out of a receptionist's reach.

for (const role of roles) {
  test.describe(`as the ${role}`, () => {
    test.use({ storageState: storageStateOf(role) });

    test("opens on the agenda", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/agenda/);
      await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
      // The account menu in the sidebar names who is signed in.
      await expect(
        page.getByRole("listitem").getByRole("button", { name: people[role].name }),
      ).toBeVisible();
    });
  });
}

const [patient] = seededPatients;
const patientName = `${patient.firstName} ${patient.lastName}`;

test.describe("as the admin", () => {
  test.use({ storageState: storageStateOf("admin") });

  test("reaches the staff and a patient's deactivation", async ({ page }) => {
    await page.goto("/pacientes");
    await expect(page.getByRole("link", { name: "Personal" })).toBeVisible();
    await page.getByRole("link", { name: patientName }).click();
    await expect(page.getByRole("heading", { level: 1, name: patientName })).toBeVisible();
    await expect(page.getByRole("button", { name: "Desactivar" })).toBeVisible();
  });
});

test.describe("as the receptionist", () => {
  test.use({ storageState: storageStateOf("receptionist") });

  test("sees no admin controls", async ({ page }) => {
    await page.goto("/pacientes");
    await page.getByRole("link", { name: patientName }).click();
    await expect(page.getByRole("heading", { level: 1, name: patientName })).toBeVisible();
    // Present for an admin on the same page (the test above), absent here.
    await expect(page.getByRole("button", { name: "Editar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Desactivar" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Personal" })).toHaveCount(0);
  });

  test("registers a patient and finds them from the search box", async ({ page }) => {
    const firstName = "Paula";
    const lastName = "Smoke";
    await page.goto("/pacientes");
    await page.getByRole("button", { name: "Nuevo paciente" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill(firstName);
    await page.getByLabel("Apellido").fill(lastName);
    await page.getByLabel("Teléfono").fill("0351 15 400-0100");
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
