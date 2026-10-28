import { describe, expect, test } from "vite-plus/test";

import { findOversizedFiles, maxEstimatedTokens } from "./check-file-tokens.ts";

const overCeiling = maxEstimatedTokens * 4 + 1;

describe("file-token ceiling", () => {
  test("reports a source file over the ceiling, with its estimate", () => {
    expect(
      findOversizedFiles([{ byteLength: overCeiling, filePath: "src/server/patients.ts" }]),
    ).toEqual([{ estimatedTokens: maxEstimatedTokens + 1, filePath: "src/server/patients.ts" }]);
  });

  test("passes a file exactly at the ceiling", () => {
    expect(
      findOversizedFiles([{ byteLength: maxEstimatedTokens * 4, filePath: "src/lib/a.ts" }]),
    ).toEqual([]);
  });

  test("exempts tests, generated files and anything outside src", () => {
    expect(
      findOversizedFiles(
        [
          "src/server/patients.test.ts",
          "src/server/patients.db.test.ts",
          "src/routeTree.gen.ts",
          "src/env.d.ts",
          "scripts/check-comment-language.ts",
          "src/db/migrations/meta/0011_snapshot.json",
        ].map((filePath) => ({ byteLength: overCeiling, filePath })),
      ),
    ).toEqual([]);
  });

  test("lists the largest first", () => {
    expect(
      findOversizedFiles([
        { byteLength: overCeiling, filePath: "src/a.tsx" },
        { byteLength: overCeiling * 2, filePath: "src/b.tsx" },
      ]).map((violation) => violation.filePath),
    ).toEqual(["src/b.tsx", "src/a.tsx"]);
  });
});
