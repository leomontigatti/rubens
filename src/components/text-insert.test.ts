import { describe, expect, it } from "vite-plus/test";

import { insertText } from "#/components/text-insert.ts";

describe("insertText", () => {
  it("writes the text in at the cursor, which lands after it", () => {
    expect(insertText("Hola , gracias", { start: 5, end: 5 }, "{{paciente}}")).toEqual({
      value: "Hola {{paciente}}, gracias",
      cursor: 17,
    });
  });

  it("replaces what is selected", () => {
    expect(insertText("Hola Lucía.", { start: 5, end: 10 }, "{{paciente}}")).toEqual({
      value: "Hola {{paciente}}.",
      cursor: 17,
    });
  });
});
