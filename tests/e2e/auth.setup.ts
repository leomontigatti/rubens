import { expect, test as setup } from "@playwright/test";

import { people, roles, storageStateOf } from "./world.ts";

// Signs each role in once, through the sign-in page, and saves the browser's
// state for the specs. The one place the suite signs in: a change of auth
// provider rewrites these steps and nothing else.

for (const role of roles) {
  setup(`sign in as the ${role}`, async ({ page }) => {
    const person = people[role];
    await page.goto("/ingresar");
    await page.getByLabel("Correo electrónico").fill(person.email);
    await page.getByLabel("Contraseña").fill(person.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).not.toHaveURL(/\/ingresar/);
    await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
    await page.context().storageState({ path: storageStateOf(role) });
  });
}
