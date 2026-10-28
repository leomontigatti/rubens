import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, expect } from "vite-plus/test";

// Lint rules are tested through `vp lint` itself, so the rule, its message and
// its file overrides are all exercised.
//
// A probe that breaks a rule cannot be committed (it would fail every lint run),
// and `--no-ignore` does not lift the config's own ignore patterns. So each probe
// is written under `tests/lint/`, linted, and removed when the file's tests end.

const root = fileURLToPath(new URL("../..", import.meta.url));

export interface Diagnostic {
  code: string;
  message: string;
  help?: string;
}

// Oxlint puts a rule's custom message in `help`, beside its generic `message`.
export const text = (d: Diagnostic) => `${d.message} ${d.help ?? ""}`;

export function lintProbes(name: string) {
  const probeDir = path.join("tests", "lint", `.probes-${name}-${process.pid}`);

  afterAll(() => {
    rmSync(path.join(root, probeDir), { recursive: true, force: true });
  });

  return function probe(file: string, source: string): string {
    mkdirSync(path.join(root, probeDir), { recursive: true });
    const relative = path.join(probeDir, file);
    writeFileSync(path.join(root, relative), source);
    return relative;
  };
}

export function lint(...files: string[]): Diagnostic[] {
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
  return report.diagnostics;
}
