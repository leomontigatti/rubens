import { expect, test } from "@playwright/test";

import { holdServerFunctions, openBooking } from "./steps.test-support.ts";
import { fullName, nextWeek, seededPatients, storageStateOf } from "./world.test-support.ts";

// #112: before the fix, the booking's patient picker kept showing the answer to
// earlier text while the answer to the text in the box was on its way, so a
// fast typist could pick a patient the box no longer matched.

test.use({ storageState: storageStateOf("receptionist") });

const held = 1_500;
const olga = fullName(seededPatients[2]);
const osvaldo = fullName(seededPatients[3]);

test("#112: the picker lists only the answer to the text in the box", async ({ page }) => {
  await openBooking(page, nextWeek(5), "15:00");
  const box = page.getByRole("combobox", { name: "Paciente" });

  // "o" finds both patients.
  await box.fill("o");
  await expect(page.getByRole("option", { name: olga })).toBeVisible();
  await expect(page.getByRole("option", { name: osvaldo })).toBeVisible();

  // Typed on, fast, with the search slow: the answer to "o" must not stand in
  // for the answer to "osv" while it is on its way.
  await holdServerFunctions(page, held);
  await box.pressSequentially("sv", { delay: 50 });
  await expect(box).toHaveValue("osv");
  // Sampled through the whole wait: a retrying assertion would pass as soon as
  // the right answer replaced the stale one.
  const seen: number[] = [];
  for (let elapsed = 0; elapsed < held; elapsed += 100) {
    seen.push(await page.getByRole("option", { name: olga }).count());
    await page.waitForTimeout(100);
  }
  expect(seen.every((count) => count === 0)).toBe(true);

  await expect(page.getByRole("option", { name: osvaldo })).toBeVisible({ timeout: held * 3 });
  await expect(page.getByRole("option", { name: olga })).toHaveCount(0);
});
