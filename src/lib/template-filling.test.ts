import { describe, expect, it } from "vite-plus/test";

import {
  fillSample,
  fillTemplate,
  sampleAppointment,
  templateValues,
} from "#/lib/template-filling.ts";
import type { TemplateAppointment } from "#/lib/template-filling.ts";

const appointment: TemplateAppointment = {
  patient: { firstName: "Martina", chosenName: null },
  practitionerName: "Dr. Juan Gómez",
  start: new Date("2099-01-05T12:05:00Z"),
  officeAddress: "Av. Colón 100",
  medicalServiceName: "Extracción dental",
  organizationName: "Consultorios Prueba",
};

describe("an appointment's template values", () => {
  it("names the patient, the organization, the practitioner, the day, the time in the practice's zone, the office's address and the medical service, lowercased to follow `tu`", () => {
    expect(templateValues(appointment)).toEqual({
      paciente: "Martina",
      organizacion: "Consultorios Prueba",
      profesional: "Dr. Juan Gómez",
      fecha: "lunes 5 de enero",
      hora: "09:05",
      domicilio: "Av. Colón 100",
      prestacion: "extracción dental",
      direccion: "Av. Colón 100",
    });
  });

  it("calls the patient by their chosen name when they have one", () => {
    const chosen = { ...appointment, patient: { firstName: "Martín", chosenName: "Tina" } };

    expect(templateValues(chosen).paciente).toBe("Tina");
  });

  it("reads the day and the time in the practice's zone, not in UTC", () => {
    const late = { ...appointment, start: new Date("2099-01-06T01:30:00Z") };

    expect(templateValues(late)).toMatchObject({ fecha: "lunes 5 de enero", hora: "22:30" });
  });
});

describe("filling a template", () => {
  it("gives the text a patient reads and Meta's value for each variable the body uses, once each, in order", () => {
    const body =
      "Hola {{paciente}}, tu turno es el {{fecha}} a las {{hora}}. Gracias {{paciente}}!";

    expect(fillTemplate(body, templateValues(appointment))).toEqual({
      text: "Hola Martina, tu turno es el lunes 5 de enero a las 09:05. Gracias Martina!",
      parameters: [
        { name: "paciente", value: "Martina" },
        { name: "fecha", value: "lunes 5 de enero" },
        { name: "hora", value: "09:05" },
      ],
    });
  });
});

describe("the sample appointment", () => {
  it("names the organization the preview is of", () => {
    expect(fillSample("Te escribimos de {{organizacion}}.", "Clínica Sur")).toBe(
      "Te escribimos de Clínica Sur.",
    );
  });

  it("gives every variable a value", () => {
    const values = Object.entries(
      templateValues({ ...sampleAppointment, organizationName: "Consultorios Prueba" }),
    );

    expect(values.filter(([, value]) => !value)).toEqual([]);
  });

  it("fills a body as the template preview shows it, the time read in the practice's zone", () => {
    expect(
      fillSample(
        "  Hola {{paciente}}, te esperamos el {{fecha}} a las {{hora}} con {{profesional}} en {{domicilio}}.\n",
        "Consultorios Prueba",
      ),
    ).toBe(
      "Hola Lucía, te esperamos el jueves 12 de noviembre a las 10:30 con la Dra. Sofía Méndez en Av. Colón 1234, Córdoba.",
    );
  });

  it("leaves a placeholder that is not a variable of any template as written", () => {
    expect(fillSample("Hola {{nombre}}, nos vemos.", "Consultorios Prueba")).toBe(
      "Hola {{nombre}}, nos vemos.",
    );
  });

  it("still fills the address of a template approved under its old name, {{direccion}}", () => {
    const body = "Te esperamos en {{direccion}}.";

    expect(fillTemplate(body, templateValues(appointment))).toEqual({
      text: "Te esperamos en Av. Colón 100.",
      parameters: [{ name: "direccion", value: "Av. Colón 100" }],
    });
  });
});
