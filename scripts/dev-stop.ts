import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { git } from "./worktree-db.ts";

// Stops this worktree's dev server: whatever listens on its `PORT` and runs
// from inside it. The target is chosen by port and working directory, never by
// matching a command line: `pkill -f <pattern>` also matches the shell that
// issued it, which is how a session kills its own Bash call.
//
// Usage: pnpm dev:stop. Exit 0 when the port ends up free or was already, 1
// when it is held from outside this worktree or the server ignored SIGTERM.

const DEFAULT_PORT = 3000;
const WAIT_MS = 5000;
const POLL_MS = 100;

type Listener = { pid: number; cwd: string | null };

export function planStop(input: { root: string; listeners: Listener[] }): {
  stop: number[];
  foreign: Listener[];
} {
  const inside = (cwd: string | null) =>
    cwd !== null && (cwd === input.root || cwd.startsWith(`${input.root}${path.sep}`));

  return {
    stop: input.listeners
      .filter((listener) => inside(listener.cwd))
      .map((listener) => listener.pid),
    foreign: input.listeners.filter((listener) => !inside(listener.cwd)),
  };
}

/** PIDs listening on the port; `lsof` exits 1 with no output when there are none. */
function listeningPids(port: number): number[] {
  try {
    return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch (error) {
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

/** The process's working directory, read through `lsof` so macOS answers too. */
function workingDirectory(pid: number): string | null {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /^n(.+)$/m.exec(output)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The pids still listening on the port other than the ones already known to be
 * foreign, once none is left or the wait ends. A replacement process that
 * binds the port meanwhile shows up here rather than counting as freed.
 */
async function remainingListeners(port: number, ignored: number[]): Promise<number[]> {
  const others = () => listeningPids(port).filter((pid) => !ignored.includes(pid));
  let remaining = others();
  for (let waited = 0; remaining.length > 0 && waited < WAIT_MS; waited += POLL_MS) {
    await delay(POLL_MS);
    remaining = others();
  }
  return remaining;
}

async function stopListeners(port: number, pids: number[], foreign: number[]): Promise<boolean> {
  if (pids.length === 0) return true;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      // Already gone between the scan and the signal: that is a stop too.
      if ((error as { code?: string }).code !== "ESRCH") throw error;
    }
  }

  const remaining = await remainingListeners(port, foreign);
  if (remaining.length === 0) console.log(`stopped ${pids.join(", ")} on ${port}`);
  else console.error(`pid ${remaining.join(", ")} still listens on ${port}`);
  return remaining.length === 0;
}

async function main() {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const listeners = listeningPids(port).map((pid) => ({
    pid,
    cwd: workingDirectory(pid),
  }));
  const { stop, foreign } = planStop({
    root: git(["rev-parse", "--show-toplevel"]),
    listeners,
  });

  if (listeners.length === 0) console.log(`nothing listening on ${port}`);
  for (const listener of foreign) {
    console.error(
      `port ${port} is held by pid ${listener.pid} outside this worktree (${listener.cwd ?? "unknown directory"}); left alone`,
    );
  }

  const stopped = await stopListeners(
    port,
    stop,
    foreign.map((listener) => listener.pid),
  );
  process.exitCode = stopped && foreign.length === 0 ? 0 : 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  await main();
}
