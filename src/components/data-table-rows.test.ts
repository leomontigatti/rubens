import { describe, expect, it } from "vite-plus/test";

import { matchingRows } from "#/components/data-table-rows.ts";

const names = ["María Pérez", "Juan Gómez"];
const search = (query: string) => matchingRows(names, (name) => name, query);

describe("matchingRows", () => {
  it("shows every row with no query", () => {
    expect(search("  ")).toEqual(names);
  });

  it("matches ignoring case and accents", () => {
    expect(search("PEREZ")).toEqual(["María Pérez"]);
  });

  it("shows none when nothing holds the query", () => {
    expect(search("Laura")).toEqual([]);
  });
});
