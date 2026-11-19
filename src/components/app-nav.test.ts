import { describe, expect, it } from "vite-plus/test";

import { isCurrentPath, isOpenOn, navFor, sectionOf } from "#/components/app-nav.ts";

const counts = (toReschedule: number | null) => ({ toReschedule });

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

  it("leaves the notifications out of the sidebar", () => {
    const links = navFor(["admin"], counts(0)).flatMap((group) => group.items);

    expect(links.some((item) => "to" in item && item.to === "/notificaciones")).toBe(false);
  });
});

describe("the breadcrumbs' section", () => {
  it("names a page outside the menu by its own label", () => {
    expect(sectionOf("/notificaciones")).toEqual([
      { label: "Notificaciones", to: "/notificaciones" },
    ]);
    expect(sectionOf("/cambiar-contrasena")).toEqual([
      { label: "Cambiar contraseña", to: "/cambiar-contrasena" },
    ]);
  });

  it("names a link's page under its group, which is no page", () => {
    expect(sectionOf("/horarios/1")).toEqual([
      { label: "Profesionales" },
      { label: "Horarios", to: "/horarios" },
    ]);
  });

  it("names a folder's page under its group and the folder", () => {
    expect(sectionOf("/whatsapp/plantillas/nueva")).toEqual([
      { label: "Administración" },
      { label: "WhatsApp" },
      { label: "Plantillas", to: "/whatsapp/plantillas" },
    ]);
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
