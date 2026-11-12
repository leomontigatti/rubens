import { describe, expect, it } from "vite-plus/test";

import { templateOptions, tooManyReminders } from "#/routes/_app/prestaciones/-template-picks.ts";

const confirmation = {
  id: "confirmation",
  name: "Confirmación del turno",
  timing: { when: "booking" as const },
  approved: true,
};
const reminder = (id: string, approved = true) => ({
  id,
  name: `Recordatorio ${id}`,
  timing: { when: "before" as const, hours: 24 },
  approved,
});
const followUp = {
  id: "followUp",
  name: "Seguimiento",
  timing: { when: "after" as const, hours: 24 },
  approved: false,
};

describe("the templates a medical service is offered", () => {
  it("offers the approved ones, each with its timing", () => {
    expect(templateOptions([confirmation, followUp], [])).toEqual([
      { value: "confirmation", label: "Confirmación del turno", detail: "Al dar el turno" },
    ]);
  });

  it("keeps one it still picks that is no longer approved, so the save does not drop it", () => {
    expect(templateOptions([confirmation, followUp], ["followUp"]).map((one) => one.value)).toEqual(
      ["confirmation", "followUp"],
    );
  });
});

describe("the reminders a medical service picks", () => {
  const templates = [confirmation, ...["a", "b", "c", "d", "e", "f"].map((id) => reminder(id))];

  it("takes up to five, whatever else it picks", () => {
    expect(tooManyReminders(templates, ["a", "b", "c", "d", "e", "confirmation"])).toBe(false);
  });

  it("refuses a sixth", () => {
    expect(tooManyReminders(templates, ["a", "b", "c", "d", "e", "f"])).toBe(true);
  });
});
