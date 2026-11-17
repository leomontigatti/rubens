import { describe, expect, it } from "vite-plus/test";

import { toPersonLastName, toPersonName } from "#/lib/person-names.ts";

describe("toPersonName", () => {
  it("title-cases each word, leaving the particles after the first in lower case", () => {
    expect(toPersonName("juan DE LA cruz")).toBe("Juan de la Cruz");
    expect(toPersonName("MARÍA DE LOS ÁNGELES")).toBe("María de los Ángeles");
    expect(toPersonName("josé y maría")).toBe("José y María");
  });

  it("saves a decomposed accent composed, as the same letter a typed one is", () => {
    expect(toPersonName("A\u0301lvaro")).toBe("Álvaro");
  });

  it("trims the name and collapses its spaces", () => {
    expect(toPersonName("  ana    lía \t pérez ")).toBe("Ana Lía Pérez");
  });

  it("capitalises a particle that starts the name", () => {
    expect(toPersonName("de los santos")).toBe("De los Santos");
  });

  it("capitalises each part of a hyphenated or apostrophed word", () => {
    expect(toPersonName("ANA-LÍA")).toBe("Ana-Lía");
    expect(toPersonName("o'brien")).toBe("O'Brien");
    expect(toPersonName("D’ANGELO")).toBe("D’Angelo");
  });
});

describe("toPersonLastName", () => {
  it("leaves a leading particle in lower case too", () => {
    expect(toPersonLastName("DE LA CRUZ")).toBe("de la Cruz");
    expect(toPersonLastName("del valle")).toBe("del Valle");
  });

  it("title-cases a last name with no particle as a name", () => {
    expect(toPersonLastName("GARCÍA-MÁRQUEZ")).toBe("García-Márquez");
  });
});
