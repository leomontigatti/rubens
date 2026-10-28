import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Source files stay small enough for an agent to read whole.
//
// A file an agent can only read in slices is a file it edits half-blind, and the
// growth is gradual: each change adds a little and none is the one to split it.
// The ceiling is in estimated tokens, at about four bytes each, because that is
// the budget a read spends. Ported from en-escena, which gates the same ceiling.
//
// It reads every tracked file under `src/`, not a diff: the tree is the baseline,
// so a file over the ceiling fails whichever branch takes it there.

export const maxEstimatedTokens = 5_500;

const sourceFilePattern = /\.(ts|tsx)$/;
// Tests grow with the cases they cover, and generated files are not edited.
const exemptFilePattern = /\.test\.tsx?$|\.d\.ts$|\.gen\.ts$/;

export type FileTokenViolation = {
  estimatedTokens: number;
  filePath: string;
};

export function isCheckedSourceFile(filePath: string): boolean {
  return (
    filePath.startsWith("src/") &&
    sourceFilePattern.test(filePath) &&
    !exemptFilePattern.test(filePath)
  );
}

export function findOversizedFiles(
  files: { byteLength: number; filePath: string }[],
): FileTokenViolation[] {
  return files
    .filter((file) => isCheckedSourceFile(file.filePath))
    .map((file) => ({
      estimatedTokens: Math.ceil(file.byteLength / 4),
      filePath: file.filePath,
    }))
    .filter((file) => file.estimatedTokens > maxEstimatedTokens)
    .sort((left, right) => right.estimatedTokens - left.estimatedTokens);
}

function trackedFiles(rootDirectory: string): string[] {
  return execFileSync("git", ["ls-files", "-z", "src"], { cwd: rootDirectory, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function main(): void {
  const rootDirectory = process.cwd();
  const violations = findOversizedFiles(
    trackedFiles(rootDirectory)
      .filter(isCheckedSourceFile)
      .map((filePath) => ({
        byteLength: statSync(path.join(rootDirectory, filePath)).size,
        filePath,
      })),
  );

  if (violations.length === 0) return;

  console.error(
    [
      `Source files above ${maxEstimatedTokens} estimated tokens (bytes / 4):`,
      ...violations.map((v) => `- ${v.filePath}: ${v.estimatedTokens}`),
      "",
      "Split each at a clear module boundary (docs/agents/coding-standards.md).",
    ].join("\n"),
  );
  process.exitCode = 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) main();
