import { describe, expect, it } from "vite-plus/test";

import {
  checkTemplateBody,
  metaTemplateName,
  templateExamples,
  templateVariables,
  versionOf,
} from "#/lib/whatsapp-templates.ts";

const own = templateVariables("0b7e6c3a-5a1f-4b8e-9d2c-1f2e3d4c5b6a");

const valid = "Hola {{paciente}}, tu turno es el {{fecha}} a las {{hora}}. Consultorios Prueba";

describe("the template rules check", () => {
  it("passes a body with named, known variables inside the text", () => {
    expect(checkTemplateBody(own, valid)).toEqual({ ok: true, body: valid });
  });

  it("refuses a body that starts or ends with a variable", () => {
    expect(checkTemplateBody(own, "{{paciente}}, tu turno es mañana.")).toEqual({
      ok: false,
      problems: [{ kind: "startsWithVariable" }],
    });
    expect(checkTemplateBody(own, "Hola, te esperamos el {{fecha}}")).toEqual({
      ok: false,
      problems: [{ kind: "endsWithVariable" }],
    });
  });

  it("reads the start and the end after the spaces around the body", () => {
    expect(checkTemplateBody(own, "  {{paciente}}, hola.\n")).toEqual({
      ok: false,
      problems: [{ kind: "startsWithVariable" }],
    });
  });

  it("refuses an unnamed variable, an uppercase one, and one the template does not fill", () => {
    const body = "Hola {{1}}, tu turno con {{Profesional}} en {{consultorio}} está listo.";

    expect(checkTemplateBody(own, body)).toEqual({
      ok: false,
      problems: [
        { kind: "unnamedVariable", variable: "1" },
        { kind: "uppercaseVariable", variable: "Profesional" },
        { kind: "unknownVariable", variable: "consultorio" },
      ],
    });
  });

  it("refuses a variable whose name is not lowercase letters and underscores", () => {
    expect(checkTemplateBody(own, "Hola {{ paciente }}, nos vemos.")).toEqual({
      ok: false,
      problems: [{ kind: "invalidVariable", variable: " paciente " }],
    });
  });

  it("refuses a variable split across lines, and a brace left open or closed alone", () => {
    expect(checkTemplateBody(own, "Hola {{PACIENTE\n}}, nos vemos.")).toEqual({
      ok: false,
      problems: [{ kind: "invalidVariable", variable: "PACIENTE\n" }],
    });
    expect(checkTemplateBody(own, "Hola {{paciente, nos vemos.")).toEqual({
      ok: false,
      problems: [{ kind: "strayBraces" }],
    });
    expect(checkTemplateBody(own, "Hola paciente}}, nos vemos.")).toEqual({
      ok: false,
      problems: [{ kind: "strayBraces" }],
    });
  });

  it("refuses a variable the template has no value for, though another template has it", () => {
    const body = "Hola {{paciente}}, tenemos una respuesta del {{fecha}} para vos.";

    expect(checkTemplateBody(templateVariables("reabrir_conversacion"), body)).toEqual({
      ok: false,
      problems: [{ kind: "unknownVariable", variable: "fecha" }],
    });
  });

  it("refuses a body over 1,024 characters, and passes one of exactly 1,024", () => {
    const filler = (length: number) => `Hola {{paciente}}, ${"a".repeat(length - 20)}.`;

    expect(filler(1024)).toHaveLength(1024);
    expect(checkTemplateBody(own, filler(1024)).ok).toBe(true);
    expect(checkTemplateBody(own, filler(1025))).toEqual({
      ok: false,
      problems: [{ kind: "tooLong", length: 1025 }],
    });
  });

  it("refuses an empty body, and one that still holds the sign-off's placeholder", () => {
    expect(checkTemplateBody(own, "  ")).toEqual({
      ok: false,
      problems: [{ kind: "empty" }],
    });
    expect(checkTemplateBody(own, "Hola {{paciente}}, nos vemos. [firma]")).toEqual({
      ok: false,
      problems: [{ kind: "signOffPlaceholder" }],
    });
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

describe("a template's name at Meta", () => {
  it("is an event template's own name and the version", () => {
    expect(metaTemplateName("turno_movido", 3)).toBe("turno_movido_v3");
    expect(versionOf("turno_movido", "turno_movido_v3")).toBe(3);
  });

  it("is the id of one of the organization's, with no hyphens, which Meta's names may not hold", () => {
    const id = "0b7e6c3a-5a1f-4b8e-9d2c-1f2e3d4c5b6a";

    expect(metaTemplateName(id, 2)).toBe("t_0b7e6c3a5a1f4b8e9d2c1f2e3d4c5b6a_v2");
    expect(versionOf(id, "t_0b7e6c3a5a1f4b8e9d2c1f2e3d4c5b6a_v2")).toBe(2);
    expect(versionOf(id, "turno_movido_v2")).toBeNull();
  });
});
