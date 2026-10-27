import { describe, expect, it } from "vite-plus/test";

import { capacityLabel } from "#/lib/offices.ts";

describe("capacityLabel", () => {
  it("is singular for one practitioner and plural from two", () => {
    expect(capacityLabel(1)).toBe("1 profesional a la vez");
    expect(capacityLabel(2)).toBe("2 profesionales a la vez");
  });
});
