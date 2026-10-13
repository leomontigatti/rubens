import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vite-plus/test";

// The lint rules that enforce ADR-0002 and ADR-0004, tested through `vp lint`
// itself so the rule, its message and its file overrides are all exercised.
//
// A probe that breaks a rule cannot be committed (it would fail every lint run),
// and `--no-ignore` does not lift the config's own ignore patterns. So each probe
// is written here, linted, and removed when the file's tests end.

const root = fileURLToPath(new URL("../..", import.meta.url));
const probeDir = path.join("tests", "lint", `.probes-${process.pid}`);

afterAll(() => {
  rmSync(path.join(root, probeDir), { recursive: true, force: true });
});

function probe(name: string, source: string): string {
  mkdirSync(path.join(root, probeDir), { recursive: true });
  const file = path.join(probeDir, name);
  writeFileSync(path.join(root, file), source);
  return file;
}

interface Diagnostic {
  code: string;
  message: string;
  help?: string;
}

// Oxlint puts a rule's custom message in `help`, beside its generic `message`.
const text = (d: Diagnostic) => `${d.message} ${d.help ?? ""}`;

function restrictedImports(...files: string[]): Diagnostic[] {
  const result = spawnSync("node_modules/.bin/vp", ["lint", "--format", "json", ...files], {
    cwd: root,
    encoding: "utf8",
    // `vp` fails to start on an inherited non-TTY stdin; a pipe is fine.
    stdio: ["pipe", "pipe", "pipe"],
  });
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) as {
    diagnostics: Diagnostic[];
    number_of_files: number;
  };
  // Guards the test itself: zero files linted would read as zero findings.
  expect(report.number_of_files).toBe(files.length);
  return report.diagnostics.filter((d) => d.code.includes("no-restricted-imports"));
}

describe("ADR lint rules", () => {
  it("reject pgTable outside the rubens schema (ADR-0004)", () => {
    const file = probe(
      "public-table.ts",
      `import { pgTable, text } from "drizzle-orm/pg-core";\n\nexport const stray = pgTable("stray", { id: text("id") });\n`,
    );

    const found = restrictedImports(file);

    expect(found).toHaveLength(1);
    expect(found.map(text).join()).toContain("ADR-0004");
  });

  it("reject the raw db client in feature code, by alias or relative path (ADR-0002)", () => {
    const byAlias = probe(
      "tenant-bypass.ts",
      `import { db } from "#/db/client.ts";\n\nexport const leak = db;\n`,
    );
    const byPath = probe(
      "tenant-bypass-relative.ts",
      `import { db } from "../../../src/db/client.ts";\n\nexport const leak = db;\n`,
    );

    const found = restrictedImports(byAlias, byPath);

    expect(found).toHaveLength(2);
    expect(found.every((d) => text(d).includes("ADR-0002"))).toBe(true);
  });

  it("allow the db client where tenancy is implemented or not needed", () => {
    expect(restrictedImports("src/db/tenant.ts", "src/lib/auth.ts", "tests/db/harness.ts")).toEqual(
      [],
    );
  });
});
