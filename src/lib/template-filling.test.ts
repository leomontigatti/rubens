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
  // 09:05 in Buenos Aires, on a Monday.
  start: new Date("2099-01-05T12:05:00Z"),
  timeZone: "America/Argentina/Buenos_Aires",
  officeName: "Sede Centro",
  officeAddress: "Av. Colón 100",
  organizationName: "Consultorios Prueba",
};

describe("an appointment's template values", () => {
  it("names the patient, the organization, the practitioner, the day, the time in the office's zone and the office", () => {
    expect(templateValues(appointment)).toEqual({
      paciente: "Martina",
      consultorio: "Consultorios Prueba",
      profesional: "Dr. Juan Gómez",
      fecha: "lunes 5 de enero",
      hora: "09:05",
      sede: "Sede Centro",
      direccion: "Av. Colón 100",
    });
  });

  it("calls the patient by their chosen name when they have one", () => {
    const chosen = { ...appointment, patient: { firstName: "Martín", chosenName: "Tina" } };

    expect(templateValues(chosen).paciente).toBe("Tina");
  });

  it("reads the day and the time in the office's zone, not in UTC", () => {
    // 01:30 UTC on Tuesday is 22:30 on Monday in Buenos Aires.
    const late = { ...appointment, start: new Date("2099-01-06T01:30:00Z") };
    const madrid = { ...appointment, timeZone: "Europe/Madrid" };

    expect(templateValues(late)).toMatchObject({ fecha: "lunes 5 de enero", hora: "22:30" });
    expect(templateValues(madrid)).toMatchObject({ fecha: "lunes 5 de enero", hora: "13:05" });
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

  it("fills the sample appointment the way the template drafts read", () => {
    const body =
      "Tu turno con {{profesional}} es el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}).";

    expect(
      fillTemplate(
        body,
        templateValues({ ...sampleAppointment, organizationName: "Consultorios Prueba" }),
      ).text,
    ).toBe(
      "Tu turno con la Dra. Sofía Méndez es el jueves 12 de noviembre a las 10:30 en Sede Centro (Av. Colón 1234, Córdoba).",
    );
  });
});

describe("the sample appointment", () => {
  it("names the organization the preview is of", () => {
    expect(fillSample("Te escribimos de {{consultorio}}.", "Clínica Sur")).toBe(
      "Te escribimos de Clínica Sur.",
    );
  });

  it("gives every variable a value", () => {
    const values = Object.entries(
      templateValues({ ...sampleAppointment, organizationName: "Consultorios Prueba" }),
    );

    expect(values.filter(([, value]) => !value)).toEqual([]);
  });

  it("fills a body as the template preview shows it, the time read in the office's zone", () => {
    // 13:30 UTC is 10:30 in Buenos Aires.
    expect(
      fillSample(
        "  Hola {{paciente}}, te esperamos el {{fecha}} a las {{hora}}.\n",
        "Consultorios Prueba",
      ),
    ).toBe("Hola Lucía, te esperamos el jueves 12 de noviembre a las 10:30.");
  });

  it("leaves what is not a variable of any template as written", () => {
    expect(fillSample("Hola {{nombre}}, en {{sede}}.", "Consultorios Prueba")).toBe(
      "Hola {{nombre}}, en Sede Centro.",
    );
  });
});
