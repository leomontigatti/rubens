import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

// One directory walk for the guardrails that scan the tree: each says which
// files it keeps, and none grows its own copy of the walk.

type CollectSourceFilesOptions = {
  directoryPath: string;
  /** Keep this file. Receives the file name, not the path. */
  keeps: (fileName: string) => boolean;
};

/**
 * A nested checkout: a git worktree carries a `.git` file pointing at the real
 * gitdir, a clone carries a `.git` directory. Either way the tree below it
 * belongs to another checkout and is not this repo's source.
 *
 * A worktree or clone nested inside the repo (a tool's scratch checkout, say)
 * would otherwise be read as a second copy of the source, at whatever commit it
 * sits on, and fail the check over work that is not this branch's. CI never sees
 * it, since a fresh clone has none.
 */
function isNestedCheckout(directoryPath: string): boolean {
  return existsSync(path.join(directoryPath, ".git"));
}

export function collectSourceFiles(options: CollectSourceFilesOptions): string[] {
  return readdirSync(options.directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(options.directoryPath, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "node_modules" || isNestedCheckout(entryPath)
        ? []
        : collectSourceFiles({ ...options, directoryPath: entryPath });
    }

    return options.keeps(entry.name) ? [entryPath] : [];
  });
}
