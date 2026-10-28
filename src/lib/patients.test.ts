import { describe, expect, it } from "vite-plus/test";

import { historyChanges, patientName } from "#/lib/patients.ts";

describe("patientName", () => {
  it("calls a patient by their chosen first name, with their last name", () => {
    expect(patientName({ firstName: "Juan", lastName: "Pérez", chosenName: "Juana" })).toBe(
      "Juana Pérez",
    );
    expect(patientName({ firstName: "Juan", lastName: "Pérez", chosenName: null })).toBe(
      "Juan Pérez",
    );
  });
});

describe("historyChanges", () => {
  it("shows each changed field's values the way the patient page does", () => {
    expect(
      historyChanges({
        before: { phone: "+5493515551234", birthDate: null, whatsappConsent: true },
        after: { phone: "+541155551234", birthDate: "2015-06-01", whatsappConsent: false },
      }),
    ).toEqual([
      { field: "Teléfono", before: "0351 15-555-1234", after: "011 5555-1234" },
      { field: "Fecha de nacimiento", before: "—", after: "01/06/2015" },
      { field: "Acepta WhatsApp", before: "Sí", after: "No" },
    ]);
  });

  it("lists a new patient's values with nothing before them", () => {
    expect(
      historyChanges({ before: null, after: { firstName: "Juan", documentType: "passport" } }),
    ).toEqual([
      { field: "Nombre", before: "—", after: "Juan" },
      { field: "Tipo de documento", before: "—", after: "Pasaporte" },
    ]);
  });

  it("lists the fields in the form's order, whatever order the log kept them in", () => {
    const changes = historyChanges({
      before: null,
      after: { phone: "+5493515551234", lastName: "Pérez", firstName: "Juan" },
    });

    expect(changes.map((change) => change.field)).toEqual(["Nombre", "Apellido", "Teléfono"]);
  });
});
