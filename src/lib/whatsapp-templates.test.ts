import { describe, expect, it } from "vite-plus/test";

import {
  checkTemplateBody,
  maxCareInstructionsLength,
  templateExamples,
} from "#/lib/whatsapp-templates.ts";

const valid = "Hola {{paciente}}, tu turno es el {{fecha}} a las {{hora}}. Consultorios Prueba";

describe("the template rules check", () => {
  it("passes a body with named, known variables inside the text", () => {
    expect(checkTemplateBody("confirmacion_turno", valid)).toEqual({ ok: true, body: valid });
  });

  it("refuses a body that starts or ends with a variable", () => {
    expect(checkTemplateBody("confirmacion_turno", "{{paciente}}, tu turno es mañana.")).toEqual({
      ok: false,
      problems: [{ kind: "startsWithVariable" }],
    });
    expect(checkTemplateBody("confirmacion_turno", "Hola, te esperamos el {{fecha}}")).toEqual({
      ok: false,
      problems: [{ kind: "endsWithVariable" }],
    });
  });

  it("reads the start and the end after the spaces around the body", () => {
    expect(checkTemplateBody("confirmacion_turno", "  {{paciente}}, hola.\n")).toEqual({
      ok: false,
      problems: [{ kind: "startsWithVariable" }],
    });
  });

  it("refuses an unnamed variable, an uppercase one, and one the template does not fill", () => {
    const body = "Hola {{1}}, tu turno con {{Profesional}} en {{consultorio}} está listo.";

    expect(checkTemplateBody("confirmacion_turno", body)).toEqual({
      ok: false,
      problems: [
        { kind: "unnamedVariable", variable: "1" },
        { kind: "uppercaseVariable", variable: "Profesional" },
        { kind: "unknownVariable", variable: "consultorio" },
      ],
    });
  });

  it("refuses a variable whose name is not lowercase letters and underscores", () => {
    expect(checkTemplateBody("confirmacion_turno", "Hola {{ paciente }}, nos vemos.")).toEqual({
      ok: false,
      problems: [{ kind: "invalidVariable", variable: " paciente " }],
    });
  });

  it("refuses a variable split across lines, and a brace left open or closed alone", () => {
    expect(checkTemplateBody("confirmacion_turno", "Hola {{PACIENTE\n}}, nos vemos.")).toEqual({
      ok: false,
      problems: [{ kind: "invalidVariable", variable: "PACIENTE\n" }],
    });
    expect(checkTemplateBody("confirmacion_turno", "Hola {{paciente, nos vemos.")).toEqual({
      ok: false,
      problems: [{ kind: "strayBraces" }],
    });
    expect(checkTemplateBody("confirmacion_turno", "Hola paciente}}, nos vemos.")).toEqual({
      ok: false,
      problems: [{ kind: "strayBraces" }],
    });
  });

  it("refuses a variable the template has no value for, though another template has it", () => {
    const body = "Hola {{paciente}}, tenemos una respuesta del {{fecha}} para vos.";

    expect(checkTemplateBody("reabrir_conversacion", body)).toEqual({
      ok: false,
      problems: [{ kind: "unknownVariable", variable: "fecha" }],
    });
  });

  it("refuses a body over 1,024 characters, and passes one of exactly 1,024", () => {
    const filler = (length: number) => `Hola {{paciente}}, ${"a".repeat(length - 20)}.`;

    expect(filler(1024)).toHaveLength(1024);
    expect(checkTemplateBody("confirmacion_turno", filler(1024)).ok).toBe(true);
    expect(checkTemplateBody("confirmacion_turno", filler(1025))).toEqual({
      ok: false,
      problems: [{ kind: "tooLong", length: 1025 }],
    });
  });

  it("refuses an empty body, and one that still holds the sign-off's placeholder", () => {
    expect(checkTemplateBody("confirmacion_turno", "  ")).toEqual({
      ok: false,
      problems: [{ kind: "empty" }],
    });
    expect(
      checkTemplateBody("confirmacion_turno", "Hola {{paciente}}, nos vemos. [firma]"),
    ).toEqual({ ok: false, problems: [{ kind: "signOffPlaceholder" }] });
  });
});

describe("a template at Meta", () => {
  it("carries one example per variable it uses, once each, from the sample appointment", () => {
    const body = "Hola {{paciente}}, el {{fecha}} a las {{hora}}. Gracias, {{paciente}}.";

    expect(templateExamples(body)).toEqual([
      { param_name: "paciente", example: "Lucía" },
      { param_name: "fecha", example: "jueves 12 de noviembre" },
      { param_name: "hora", example: "10:30" },
    ]);
  });
});

describe("the room a template leaves for care instructions", () => {
  it("is the body's limit less the text outside its variables", () => {
    expect(maxCareInstructionsLength("Hola {{paciente}}: {{indicaciones}}. Saludos")).toBe(
      1024 - "Hola : . Saludos".length,
    );
  });

  it("is shared among each place the body repeats them", () => {
    expect(maxCareInstructionsLength("Hoy: {{indicaciones}}. Repito: {{indicaciones}}.")).toBe(
      Math.floor((1024 - "Hoy: . Repito: .".length) / 2),
    );
  });
});
