import { describe, expect, it } from "vite-plus/test";

import { lintProbes, text } from "./lint.test-support.ts";

// The lint rules that enforce ADR-0002 and ADR-0004.

const { probe, existing, lint } = lintProbes("adr");

const restrictedImports = (...files: string[]) =>
  lint(...files).filter((d) => d.code.includes("no-restricted-imports"));

// The one type-aware `vp lint` runs inside the first test, slower cold.
describe("ADR lint rules", { timeout: 30_000 }, () => {
  const publicTableProbe = probe(
    "public-table.ts",
    `import { pgTable, text } from "drizzle-orm/pg-core";\n\nexport const stray = pgTable("stray", { id: text("id") });\n`,
  );

  it("reject pgTable outside the rubens schema (ADR-0004)", () => {
    const found = restrictedImports(publicTableProbe);

    expect(found).toHaveLength(1);
    expect(found.map(text).join()).toContain("ADR-0004");
  });

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

  it("reject the raw db client in feature code: alias, relative path, dynamic import (ADR-0002)", () => {
    const found = restrictedImports(byAlias, byPath, byDynamicImport);

    expect(found).toHaveLength(3);
    expect(found.every((d) => text(d).includes("ADR-0002"))).toBe(true);
  });

  const tenancyFiles = [
    existing("src/db/tenant.ts"),
    existing("src/lib/auth.ts"),
    existing("tests/db/harness.ts"),
  ];

  it("allow the db client where tenancy is implemented or not needed", () => {
    expect(restrictedImports(...tenancyFiles)).toEqual([]);
  });
});
