import { describe, expect, it } from "vite-plus/test";

import { isCurrentPath, isOpenOn, navFor } from "#/components/app-nav.ts";

const counts = (toReschedule: number | null, unreadNotifications = 0) => ({
  toReschedule,
  unreadNotifications,
});

describe("the menu a member sees", () => {
  it("leaves the admin's screens out for anyone else", () => {
    const administration = navFor(["receptionist", "practitioner"], counts(0)).at(-1)!;

    expect(administration.items.map((item) => item.label)).toEqual(["Sedes", "Cierres"]);
  });

  it("keeps them for a member who is an admin among other roles", () => {
    const administration = navFor(["practitioner", "admin"], counts(0)).at(-1)!;

    expect(administration.items.map((item) => item.label)).toContain("Personal");
  });

  it("counts the list on its link, and drops the link when the count is refused", () => {
    const daily = (count: number | null) => navFor(["practitioner"], counts(count))[0]!.items;

    expect(daily(3).find((item) => "to" in item && item.to === "/a-reprogramar")?.count).toBe(3);
    expect(daily(null).some((item) => "to" in item && item.to === "/a-reprogramar")).toBe(false);
  });

  it("counts the member's unread notifications on their link, for every role", () => {
    const daily = navFor(["receptionist"], counts(0, 2))[0]!.items;

    expect(daily.find((item) => "to" in item && item.to === "/notificaciones")?.count).toBe(2);
  });
});

describe("the WhatsApp group", () => {
  const whatsapp = () => {
    const item = navFor(["admin"], counts(0))
      .at(-1)!
      .items.find((one) => one.label === "WhatsApp")!;
    if (!("entries" in item)) {
      throw new Error("WhatsApp is a link, not a group");
    }
    return item;
  };

  it("is a group of its two pages, with no page of its own", () => {
    const group = whatsapp();

    expect(group).not.toHaveProperty("to");
    expect(group.entries).toEqual([
      { label: "Configuración", to: "/whatsapp/configuracion" },
      { label: "Plantillas", to: "/whatsapp/plantillas" },
    ]);
  });

  it("opens on one of its pages and the pages under them, closed elsewhere", () => {
    const group = whatsapp();

    expect(isOpenOn("/whatsapp/configuracion/reglas", group)).toBe(true);
    expect(isOpenOn("/whatsapp/plantillas/seguimiento", group)).toBe(true);
    expect(isOpenOn("/agenda", group)).toBe(false);
  });

  it("is an admin's only", () => {
    const administration = navFor(["receptionist"], counts(0)).at(-1)!;

    expect(administration.items.some((item) => item.label === "WhatsApp")).toBe(false);
  });
});

describe("the current link", () => {
  it("holds for its page and the pages under it, not for a longer name", () => {
    expect(isCurrentPath("/sedes", "/sedes")).toBe(true);
    expect(isCurrentPath("/sedes/1", "/sedes")).toBe(true);
    expect(isCurrentPath("/sedes-viejas", "/sedes")).toBe(false);
  });
});
