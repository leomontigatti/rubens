import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadEnv } from "vite-plus";

// A worktree's own dev server port, so concurrent sessions' dev servers and
// browser suites (`tests/e2e/environment.ts`, the port plus 10,000) never take
// each other's. It lands in a gitignored `.env.local`, which `vp dev` loads
// over the `.env`. `ensure` (run ahead of `pnpm dev`) writes it on first use;
// the main checkout keeps port 3000. `--print` (`pnpm dev:url`) prints the URL,
// so nobody has to open `.env.local`, which agents are denied.

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

const DEFAULT_PORT = 3000;

// The port `vp dev` serves on: `vite.config.ts` reads it here, so the URL
// `--print` gives is the one the server takes.
export function devPort(root: string): number {
  return Number(loadEnv("development", root, "").PORT) || DEFAULT_PORT;
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

// Writes the worktree's `.env.local` when it has none; returns the port it wrote.
function ensure(): number | undefined {
  const root = git(["rev-parse", "--show-toplevel"]);
  const envLocalPath = path.join(root, ENV_LOCAL);

  if (isMainCheckout(root) || existsSync(envLocalPath)) {
    return undefined;
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
  return port;
}

function main() {
  const written = ensure();

  if (process.argv.includes("--print")) {
    console.log(`http://localhost:${devPort(git(["rev-parse", "--show-toplevel"]))}`);
  } else if (written !== undefined) {
    console.log(`Dev server: http://localhost:${written} (pnpm dev)`);
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
