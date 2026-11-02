import { describe, expect, it } from "vite-plus/test";

import { filterChange, roomOptions, serviceOptions } from "#/routes/_app/agenda/-filter-changes.ts";

const practitioners = [
  { id: "laura", displayName: "Laura" },
  { id: "pablo", displayName: "Pablo" },
];
const medicalServices = [
  { id: "consulta", name: "Consulta", durationMinutes: 30, practitionerId: "laura" },
  { id: "limpieza", name: "Limpieza", durationMinutes: 45, practitionerId: "pablo" },
];
const week = (practitionerId: string | null) => ({
  practitioners,
  medicalServices,
  filter: { practitionerId },
});

describe("calendar filter changes", () => {
  it("drop the practitioner and the medical service with a new room", () => {
    expect(filterChange("consultorio", "room", week(null))).toEqual({
      consultorio: "room",
      profesional: undefined,
      prestacion: undefined,
    });
  });

  it("drop the medical service with a new practitioner", () => {
    expect(filterChange("profesional", "pablo", week("laura"))).toEqual({
      profesional: "pablo",
      prestacion: undefined,
    });
  });

  it("show everyone when the practitioner is removed", () => {
    expect(filterChange("profesional", null, week("laura"))).toEqual({
      profesional: undefined,
      prestacion: undefined,
    });
  });

  it("set the medical service's practitioner", () => {
    expect(filterChange("prestacion", "limpieza", week(null))).toEqual({
      prestacion: "limpieza",
      profesional: "pablo",
    });
  });

  it("keep the practitioner when the medical service is removed", () => {
    expect(filterChange("prestacion", null, week("laura"))).toEqual({ prestacion: undefined });
  });
});

describe("the calendar's medical service options", () => {
  it("name each one's practitioner when everyone is shown", () => {
    expect(serviceOptions(week(null)).map((one) => one.label)).toEqual([
      "Consulta (30 min) · Laura",
      "Limpieza (45 min) · Pablo",
    ]);
  });

  it("list only the chosen practitioner's, unnamed", () => {
    expect(serviceOptions(week("laura"))).toEqual([
      { value: "consulta", label: "Consulta (30 min)" },
    ]);
  });
});

describe("the calendar's room options", () => {
  const roomChoices = [
    { officeId: "centro", officeName: "Centro", rooms: [{ id: "uno", name: "Uno" }] },
  ];

  it("list the rooms under their office", () => {
    expect(roomOptions({ id: "uno", name: "Uno" }, "Centro", roomChoices)).toEqual([
      { value: "uno", label: "Uno", section: "Centro" },
    ]);
  });

  it("keep a deactivated room being viewed, which the choices leave out", () => {
    expect(roomOptions({ id: "viejo", name: "Viejo" }, "Norte", roomChoices)).toEqual([
      { value: "viejo", label: "Viejo", section: "Norte" },
      { value: "uno", label: "Uno", section: "Centro" },
    ]);
  });
});
