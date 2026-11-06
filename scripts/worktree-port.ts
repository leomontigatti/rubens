import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// A worktree's own dev server port, so concurrent sessions' dev servers and
// browser suites (`tests/e2e/environment.ts`, the port plus 10,000) never take
// each other's. It lands in a gitignored `.env.local`, which `vp dev` loads
// over the `.env`. `ensure` (run ahead of `pnpm dev`) writes it on first use;
// the main checkout keeps port 3000.

const PORT_MIN = 5200;
const PORT_SPAN = 800;
const ENV_LOCAL = ".env.local";

// A hash of the worktree's directory name picks the starting port, so a
// worktree keeps its port across re-runs; a port another worktree's
// `.env.local` already claims is stepped past rather than shared.
export function choosePort(worktreeName: string, claimed: Set<number>): number {
  let hash = 2166136261;

  for (const char of worktreeName) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }

  for (let step = 0; step < PORT_SPAN; step++) {
    const port = PORT_MIN + ((hash + step) % PORT_SPAN);

    if (!claimed.has(port)) {
      return port;
    }
  }

  throw new Error(`Every port from ${PORT_MIN} is claimed by a worktree.`);
}

export function renderEnvLocal(port: number): string {
  return [
    "# Written by `pnpm dev` (scripts/worktree-port.ts): this worktree's own dev",
    "# port, loaded over the shared .env.",
    `PORT="${port}"`,
    "",
  ].join("\n");
}

export function parseEnvPort(content: string): number | undefined {
  const match = /^PORT="?(\d+)"?$/m.exec(content);
  return match ? Number(match[1]) : undefined;
}

export function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function worktreePaths(): string[] {
  return git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function isMainCheckout(root: string): boolean {
  return (
    path.resolve(root, git(["rev-parse", "--git-dir"])) ===
    path.resolve(root, git(["rev-parse", "--git-common-dir"]))
  );
}

function ensure() {
  const root = git(["rev-parse", "--show-toplevel"]);
  const envLocalPath = path.join(root, ENV_LOCAL);

  if (isMainCheckout(root) || existsSync(envLocalPath)) {
    return;
  }

  const claimed = new Set(
    worktreePaths()
      .filter((worktree) => path.resolve(worktree) !== path.resolve(root))
      .map((worktree) => path.join(worktree, ENV_LOCAL))
      .filter((file) => existsSync(file))
      .map((file) => parseEnvPort(readFileSync(file, "utf8")))
      .filter((port): port is number => port !== undefined),
  );
  const port = choosePort(path.basename(root), claimed);

  writeFileSync(envLocalPath, renderEnvLocal(port));
  console.log(`Dev server: http://localhost:${port} (pnpm dev)`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  try {
    ensure();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
