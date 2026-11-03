import { describe, expect, it } from "vite-plus/test";

import { patientBoxChange } from "#/routes/_app/agenda/-patient-box.ts";

describe("patientBoxChange", () => {
  it("searches for what is typed", () => {
    expect(patientBoxChange("juan p", "input-change", false)).toEqual({
      text: "juan p",
      query: "juan p",
      dropPick: false,
    });
  });

  it("drops the patient picked when the user types over their name", () => {
    expect(patientBoxChange("Juan Pére", "input-change", true)?.dropPick).toBe(true);
  });

  it("shows a pick's name without searching for it", () => {
    expect(patientBoxChange("Juan Pérez", "item-press", false)).toEqual({
      text: "Juan Pérez",
      query: "",
      dropPick: false,
    });
  });

  it("keeps what was typed when the list closes or Escape is pressed", () => {
    expect(patientBoxChange("", "input-clear", false)).toBeNull();
    expect(patientBoxChange("", "escape-key", false)).toBeNull();
  });

  it("empties the box when Escape clears the patient picked", () => {
    expect(patientBoxChange("", "escape-key", true)).toEqual({
      text: "",
      query: "",
      dropPick: false,
    });
  });
});
