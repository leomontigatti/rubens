import { describe, expect, it } from "vite-plus/test";

import {
  addableGroups,
  appliedGroups,
  matchingOptions,
  optionSections,
} from "#/components/filter-groups.ts";
import type { FilterGroup } from "#/components/filter-groups.ts";

const group = (id: string, value: string | null, values = ["a", "b"]): FilterGroup => ({
  id,
  label: id,
  value,
  options: values.map((one) => ({ value: one, label: one.toUpperCase() })),
});

describe("filter groups", () => {
  it("apply a group with a value, each with the option it reads as", () => {
    const applied = appliedGroups([group("room", "a"), group("practitioner", null)]);

    expect(applied.map((one) => [one.id, one.selected.label])).toEqual([["room", "A"]]);
  });

  it("leave out a value no option has, rather than show a raw id", () => {
    expect(appliedGroups([group("room", "gone")])).toEqual([]);
  });

  it("offer the unapplied groups that have something to pick", () => {
    const addable = addableGroups([
      group("room", "a"),
      group("practitioner", null),
      group("service", null, []),
    ]);

    expect(addable.map((one) => one.id)).toEqual(["practitioner"]);
  });

  it("offer a group whose stale value applies nothing", () => {
    expect(addableGroups([group("room", "gone")]).map((one) => one.id)).toEqual(["room"]);
  });

  it("match options whatever the case and accents typed", () => {
    const options = [
      { value: "1", label: "José Pérez" },
      { value: "2", label: "Ana Gómez" },
    ];

    expect(matchingOptions(options, " jose ")).toEqual([options[0]]);
    expect(matchingOptions(options, "GÓMEZ")).toEqual([options[1]]);
    expect(matchingOptions(options, "")).toEqual(options);
  });

  it("keep options under their section, in order", () => {
    const options = [
      { value: "1", label: "Uno", section: "Centro" },
      { value: "2", label: "Dos", section: "Norte" },
      { value: "3", label: "Tres", section: "Centro" },
    ];

    expect(optionSections(options)).toEqual([
      { name: "Centro", options: [options[0], options[2]] },
      { name: "Norte", options: [options[1]] },
    ]);
  });

  it("put options with no section in one nameless section", () => {
    const options = [{ value: "1", label: "Uno" }];

    expect(optionSections(options)).toEqual([{ name: undefined, options }]);
  });
});
