import { describe, expect, it } from "vite-plus/test";

import { comboboxTextChange } from "#/components/combobox-text.ts";

describe("comboboxTextChange", () => {
  it("searches for what is typed", () => {
    expect(comboboxTextChange("juan p", "input-change", false)).toEqual({
      text: "juan p",
      query: "juan p",
      dropPick: false,
    });
  });

  it("drops the pick when the user types over its name", () => {
    expect(comboboxTextChange("Juan Pére", "input-change", true)?.dropPick).toBe(true);
  });

  it("shows the name of a pick without searching for it", () => {
    expect(comboboxTextChange("Juan Pérez", "item-press", false)).toEqual({
      text: "Juan Pérez",
      query: "",
      dropPick: false,
    });
  });

  it("keeps what was typed when the list closes or Escape is pressed", () => {
    expect(comboboxTextChange("", "input-clear", false)).toBeNull();
    expect(comboboxTextChange("", "escape-key", false)).toBeNull();
  });

  it("empties the box when Escape clears the pick", () => {
    expect(comboboxTextChange("", "escape-key", true)).toEqual({
      text: "",
      query: "",
      dropPick: false,
    });
  });
});
