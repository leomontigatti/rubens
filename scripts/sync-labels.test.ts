import { describe, expect, test } from "vite-plus/test";

import { planLabelSync } from "./sync-labels.ts";

const bug = { color: "d73a4a", description: "Wrong behaviour", name: "bug" };
const chore = { color: "bfd4f2", description: "Tooling", name: "chore" };

describe("label sync plan", () => {
  test("creates what is missing and updates what differs", () => {
    const plan = planLabelSync({
      desired: [bug, chore],
      live: [{ ...bug, description: "Something isn't working" }],
    });

    expect(plan).toEqual({
      create: [chore],
      extra: [],
      update: [bug],
    });
  });

  test("reports a live label the file does not hold, and never deletes it", () => {
    const plan = planLabelSync({
      desired: [bug],
      live: [bug, { color: "cfd3d7", description: "", name: "duplicate" }],
    });

    expect(plan).toEqual({ create: [], extra: ["duplicate"], update: [] });
  });

  // GitHub answers colours in lower case; a file written in upper case must not
  // rewrite every label on every run.
  test("is idempotent, and compares colours case-insensitively", () => {
    const plan = planLabelSync({
      desired: [{ ...bug, color: "D73A4A" }],
      live: [bug],
    });

    expect(plan).toEqual({ create: [], extra: [], update: [] });
  });
});
