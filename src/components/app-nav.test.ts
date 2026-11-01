import { describe, expect, it } from "vite-plus/test";

import { isCurrentPath, navFor } from "#/components/app-nav.ts";

describe("the menu a member sees", () => {
  it("leaves the admin's screens out for anyone else", () => {
    const administration = navFor(["receptionist", "practitioner"], 0).at(-1)!;

    expect(administration.items.map((item) => item.label)).toEqual(["Sedes", "Cierres"]);
  });

  it("keeps them for a member who is an admin among other roles", () => {
    const administration = navFor(["practitioner", "admin"], 0).at(-1)!;

    expect(administration.items.map((item) => item.label)).toContain("Personal");
  });

  it("counts the list on its link, and drops the link when the count is refused", () => {
    const daily = (count: number | null) => navFor(["practitioner"], count)[0]!.items;

    expect(daily(3).find((item) => item.to === "/a-reprogramar")?.count).toBe(3);
    expect(daily(null).some((item) => item.to === "/a-reprogramar")).toBe(false);
  });
});

describe("the current link", () => {
  it("holds for its page and the pages under it, not for a longer name", () => {
    expect(isCurrentPath("/sedes", "/sedes")).toBe(true);
    expect(isCurrentPath("/sedes/1", "/sedes")).toBe(true);
    expect(isCurrentPath("/sedes-viejas", "/sedes")).toBe(false);
  });
});
