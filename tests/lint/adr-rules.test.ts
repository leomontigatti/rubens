import { describe, expect, it } from "vite-plus/test";

import { lint, lintProbes, text } from "./lint.test-support.ts";

// The lint rules that enforce ADR-0002 and ADR-0004.

const probe = lintProbes("adr");

const restrictedImports = (...files: string[]) =>
  lint(...files).filter((d) => d.code.includes("no-restricted-imports"));

// Each case spawns a type-aware `vp lint`: well under a second warm, slower cold.
describe("ADR lint rules", { timeout: 30_000 }, () => {
  it("reject pgTable outside the rubens schema (ADR-0004)", () => {
    const file = probe(
      "public-table.ts",
      `import { pgTable, text } from "drizzle-orm/pg-core";\n\nexport const stray = pgTable("stray", { id: text("id") });\n`,
    );

    const found = restrictedImports(file);

    expect(found).toHaveLength(1);
    expect(found.map(text).join()).toContain("ADR-0004");
  });

  it("reject the raw db client in feature code: alias, relative path, dynamic import (ADR-0002)", () => {
    const byAlias = probe(
      "tenant-bypass.ts",
      `import { db } from "#/db/client.ts";\n\nexport const leak = db;\n`,
    );
    const byPath = probe(
      "tenant-bypass-relative.ts",
      `import { db } from "../../../src/db/client.ts";\n\nexport const leak = db;\n`,
    );
    const byDynamicImport = probe(
      "tenant-bypass-dynamic.ts",
      `export async function leak() {\n  const { db } = await import("#/db/client.ts");\n  return db;\n}\n`,
    );

    const found = restrictedImports(byAlias, byPath, byDynamicImport);

    expect(found).toHaveLength(3);
    expect(found.every((d) => text(d).includes("ADR-0002"))).toBe(true);
  });

  it("allow the db client where tenancy is implemented or not needed", () => {
    expect(restrictedImports("src/db/tenant.ts", "src/lib/auth.ts", "tests/db/harness.ts")).toEqual(
      [],
    );
  });
});
