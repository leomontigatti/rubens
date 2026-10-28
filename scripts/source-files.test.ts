import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { collectSourceFiles } from "./source-files.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "source-files-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function write(relativePath: string, contents = "") {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function collected() {
  return collectSourceFiles({
    directoryPath: root,
    keeps: (fileName) => fileName.endsWith(".md"),
  })
    .map((absolutePath) => path.relative(root, absolutePath))
    .sort();
}

describe("collectSourceFiles", () => {
  test("walks nested directories and keeps only what it is asked for", () => {
    write("a.md");
    write("nested/b.md");
    write("nested/c.txt");

    expect(collected()).toEqual(["a.md", path.join("nested", "b.md")]);
  });

  test("does not descend into `node_modules`", () => {
    write("a.md");
    write("node_modules/pkg/readme.md");

    expect(collected()).toEqual(["a.md"]);
  });

  // The shape that broke the comment-language gate in the main checkout: this
  // repo keeps its worktrees at `.claude/worktrees/<name>`, inside a directory
  // the doc scan walks, so the guardrail read a whole second copy of the repo
  // and reported 262 findings against another branch's files.
  test("does not descend into a git worktree, whose `.git` is a file", () => {
    write("a.md");
    write(".claude/worktrees/other/.git", "gitdir: /elsewhere/.git/worktrees/other\n");
    write(".claude/worktrees/other/docs/spanish.md", "El turno no se libera.\n");

    expect(collected()).toEqual(["a.md"]);
  });

  test("does not descend into a clone, whose `.git` is a directory", () => {
    write("a.md");
    write("vendor/repo/.git/HEAD", "ref: refs/heads/master\n");
    write("vendor/repo/docs/spanish.md", "El turno no se libera.\n");

    expect(collected()).toEqual(["a.md"]);
  });
});
