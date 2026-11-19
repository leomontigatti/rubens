import { expect, test as setup } from "@playwright/test";

import { pickOption } from "./steps.test-support.ts";
import { people, roles, storageStateOf } from "./world.test-support.ts";

// Signs each role in once, through the dev sign-in on `/ingresar`, and saves
// the browser's state for the specs. The one place the suite signs in: a
// change of auth provider rewrites these steps and nothing else.

for (const role of roles) {
  setup(`sign in as the ${role}`, async ({ page }) => {
    const person = people[role];
    await page.goto("/ingresar");
    // The option names the member and their roles.
    await pickOption(page, "Miembro", new RegExp(`^${person.name} \\(`));
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).not.toHaveURL(/\/ingresar/);
    // The account menu at the end of the top bar names who is signed in.
    await expect(page.locator("header").getByRole("button", { name: person.name })).toBeVisible();
    await page.context().storageState({ path: storageStateOf(role) });
  });
}
