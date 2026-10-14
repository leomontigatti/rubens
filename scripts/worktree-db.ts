import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// A worktree's own database and dev server port, so concurrent sessions stop
// migrating and testing over each other's data. Both land in a
// gitignored `.env.local`, which `vp dev` and the `db:*` scripts load
// over the `.env`.
//
// `ensure` (run ahead of `pnpm dev` and `db:migrate`) sets it up on first use,
// so a thread that never needs data never gets a database; with no argument
// (`pnpm db:worktree`) it re-runs the setup. `prune` lists the databases of
// removed worktrees, and `prune --apply` drops them; the `housekeeping` skill
// runs it.
//
// Two URLs, as in ADR-0002: `DATABASE_URL` is the app role (`rubens_app`, the
// one RLS applies to) and `DATABASE_DIRECT_URL` is the owner role used by
// migrations. Both point at this worktree's database.

const CONTAINER = "rubens-postgres";
const PREFIX = "rubens-wt-";
const PORT_MIN = 5200;
const PORT_SPAN = 800;
const ENV_LOCAL = ".env.local";

export function worktreeDatabaseName(worktreePath: string): string {
  const slug = path
    .basename(worktreePath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${PREFIX}${slug}`.slice(0, 63);
}

export function databaseUrlFor(baseUrl: string, database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

// A hash of the database name picks the starting port, so a worktree keeps its
// port across re-runs; a port another worktree's `.env.local` already claims is
// stepped past rather than shared.
export function choosePort(database: string, claimed: Set<number>): number {
  let hash = 2166136261;

  for (const char of database) {
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

export function renderEnvLocal(input: {
  databaseUrl: string;
  directDatabaseUrl: string;
  port: number;
}): string {
  const origin = `http://localhost:${input.port}`;

  return [
    "# Written by `pnpm db:worktree`: this worktree's own database and dev port,",
    "# loaded over the shared .env. Rewritten on every run.",
    `DATABASE_URL="${input.databaseUrl}"`,
    `DATABASE_DIRECT_URL="${input.directDatabaseUrl}"`,
    `PORT="${input.port}"`,
    `BETTER_AUTH_URL="${origin}"`,
    "",
  ].join("\n");
}

export function parseEnvPort(content: string): number | undefined {
  const match = /^PORT="?(\d+)"?$/m.exec(content);
  return match ? Number(match[1]) : undefined;
}

export function planPrune(input: { databases: string[]; worktreePaths: string[] }): string[] {
  const live = new Set(input.worktreePaths.map(worktreeDatabaseName));

  return input.databases.filter((name) => name.startsWith(PREFIX) && !live.has(name));
}

export function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function worktreePaths(): string[] {
  return git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atc", sql],
    { encoding: "utf8" },
  ).trim();
}

export function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);

  const result = spawnSync(command, args, {
    env: { ...process.env, ...env },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} exited with ${result.status}`);
  }
}

function isMainCheckout(root: string): boolean {
  return (
    path.resolve(root, git(["rev-parse", "--git-dir"])) ===
    path.resolve(root, git(["rev-parse", "--git-common-dir"]))
  );
}

function ensure() {
  const root = git(["rev-parse", "--show-toplevel"]);

  if (!isMainCheckout(root) && !existsSync(path.join(root, ENV_LOCAL))) {
    console.log("First use of the database here: setting up this worktree's.");
    setUp(root);
  }
}

function pickPort(root: string, envLocalPath: string, database: string) {
  const ownPort = existsSync(envLocalPath)
    ? parseEnvPort(readFileSync(envLocalPath, "utf8"))
    : undefined;
  const claimed = new Set(
    worktreePaths()
      .filter((worktree) => path.resolve(worktree) !== path.resolve(root))
      .map((worktree) => path.join(worktree, ENV_LOCAL))
      .filter((file) => existsSync(file))
      .map((file) => parseEnvPort(readFileSync(file, "utf8")))
      .filter((port): port is number => port !== undefined),
  );

  return ownPort !== undefined && !claimed.has(ownPort) ? ownPort : choosePort(database, claimed);
}

function migrate(options: {
  envLocalPath: string;
  databaseUrl: string;
  directDatabaseUrl: string;
  port: number;
  database: string;
  created: boolean;
}) {
  const { envLocalPath, databaseUrl, directDatabaseUrl, port, database, created } = options;
  const hadEnvLocal = existsSync(envLocalPath);

  writeFileSync(envLocalPath, renderEnvLocal({ databaseUrl, directDatabaseUrl, port }));

  const env = { DATABASE_URL: databaseUrl, DATABASE_DIRECT_URL: directDatabaseUrl };

  try {
    run("pnpm", ["db:migrate"], env);
  } catch (error) {
    // A half-set-up worktree must not look set up: `ensure` skips a worktree
    // that has `.env.local`, so leave nothing behind for the next run to trust.
    if (!hadEnvLocal) rmSync(envLocalPath, { force: true });
    if (created) {
      try {
        run("docker", ["exec", CONTAINER, "dropdb", "-U", "postgres", database]);
      } catch (cleanupError) {
        console.error(`Could not drop ${database}: ${String(cleanupError)}`);
      }
    }
    throw error;
  }
}

function setUp(root: string) {
  if (isMainCheckout(root)) {
    console.log("This is the main checkout; it keeps the rubens database.");
    return;
  }

  const baseUrl = process.env.DATABASE_URL;
  const baseDirectUrl = process.env.DATABASE_DIRECT_URL;

  if (!baseUrl || !baseDirectUrl) {
    throw new Error("DATABASE_URL and DATABASE_DIRECT_URL are required; is .env present?");
  }

  const database = worktreeDatabaseName(root);
  const databaseUrl = databaseUrlFor(baseUrl, database);
  const directDatabaseUrl = databaseUrlFor(baseDirectUrl, database);
  const envLocalPath = path.join(root, ENV_LOCAL);
  const port = pickPort(root, envLocalPath, database);

  run("docker", ["compose", "up", "-d", "--wait", "postgres"]);

  const created = psql(`select 1 from pg_database where datname = '${database}'`) !== "1";

  if (created) {
    run("docker", ["exec", CONTAINER, "createdb", "-U", "postgres", database]);
  }

  migrate({
    envLocalPath,
    databaseUrl,
    directDatabaseUrl,
    port,
    database,
    created,
  });

  console.log(`\nDatabase: ${database}`);
  console.log(`Dev server: http://localhost:${port} (pnpm dev)`);
}

export function prune(dryRun: boolean, livePaths = worktreePaths()) {
  const drop = planPrune({
    databases: psql("select datname from pg_database").split("\n"),
    worktreePaths: livePaths,
  });

  if (drop.length === 0) {
    console.log("No database belongs to a removed worktree.");
    return;
  }

  for (const database of drop) {
    console.log(`${dryRun ? "Would drop" : "Dropping"} ${database}`);

    if (!dryRun) {
      // --force ends its sessions in the same step, so a client that reconnects
      // cannot make the drop fail halfway through the list.
      run("docker", ["exec", CONTAINER, "dropdb", "--force", "-U", "postgres", database]);
    }
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  try {
    if (process.argv.includes("ensure")) {
      ensure();
    } else if (process.argv.includes("prune")) {
      prune(!process.argv.includes("--apply"));
    } else {
      setUp(git(["rev-parse", "--show-toplevel"]));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
