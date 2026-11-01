import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vite-plus/test";

// Lint rules are tested through `vp lint` itself, so the rule, its message and
// its file overrides are all exercised. A type-aware run costs about 2 s however
// few files it reads, so a test file makes one: it declares its probes while it
// is collected, and the first `lint()` lints them all together.
//
// A probe that breaks a rule cannot be committed (it would fail every lint run),
// and `--no-ignore` does not lift the config's own ignore patterns. So the probes
// are written under `tests/lint/` for that one run, and removed straight after.

const root = fileURLToPath(new URL("../..", import.meta.url));

export interface Diagnostic {
  code: string;
  message: string;
  help?: string;
  filename: string;
}

// Oxlint puts a rule's custom message in `help`, beside its generic `message`.
export const text = (d: Diagnostic) => `${d.message} ${d.help ?? ""}`;

export function lintProbes(name: string) {
  const probeDir = path.join("tests", "lint", `.probes-${name}-${process.pid}`);
  const probes = new Map<string, string>();
  const committed: string[] = [];
  let diagnostics: Diagnostic[] | undefined;

  function lintEverything() {
    mkdirSync(path.join(root, probeDir), { recursive: true });
    for (const [file, source] of probes) {
      writeFileSync(path.join(root, file), source);
    }
    try {
      return runLint([...probes.keys(), ...committed]);
    } finally {
      rmSync(path.join(root, probeDir), { recursive: true, force: true });
    }
  }

  return {
    /** Declares a file holding `source`, at collection time, and returns its path. */
    probe(file: string, source: string): string {
      const relative = path.join(probeDir, file);
      probes.set(relative, source);
      return relative;
    },
    /** Declares a file of the repository for the same run. */
    existing(file: string): string {
      committed.push(file);
      return file;
    },
    /** The findings on `files`, from the one run over everything declared. */
    lint(...files: string[]): Diagnostic[] {
      diagnostics ??= lintEverything();
      return diagnostics.filter((d) => files.includes(d.filename));
    },
  };
}

function runLint(files: string[]): Diagnostic[] {
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
