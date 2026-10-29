import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { TestProject } from "vite-plus/test/node";

import { testExtensions } from "./extensions.ts";

const migrationsFolder = fileURLToPath(new URL("../../src/db/migrations", import.meta.url));

/**
 * The `provide` key for the path of the migrated data directory, a tarball.
 * Vitest comes bundled in Vite+, not as a direct dependency, so its
 * `ProvidedContext` cannot be augmented to type the key.
 */
export const migratedDataDirKey = "migratedDataDir" as never;

/**
 * Migrates one PGlite database before the db project runs and hands its data
 * directory to every test file (`createTestDatabase` loads it). Loading the
 * tarball takes well under a second; migrating from scratch takes 3 to 5.
 *
 * Vitest runs a global setup once per process, so in watch mode a rerun
 * rebuilds the tarball when a migration changed since it was built.
 */
export default async function setup(project: TestProject) {
  const directory = await mkdtemp(path.join(tmpdir(), "rubens-pglite-"));
  const removeDirectory = () => rm(directory, { recursive: true, force: true });
  const file = path.join(directory, "migrated.tar");
  let builtFrom: string | undefined;
  try {
    builtFrom = await migrationsFingerprint();
    await writeMigratedDataDir(file);
  } catch (error) {
    await removeDirectory();
    throw error;
  }
  project.provide(migratedDataDirKey, file as never);

  // A throw here would abort the rerun outside Vitest's error reporting.
  // Instead a failure removes the template and forgets what it was built from,
  // so every test fails on the missing file rather than passing against the
  // old schema, and the next rerun rebuilds whatever the migrations are then.
  project.onTestsRerun(async () => {
    try {
      const current = await migrationsFingerprint();
      if (current !== builtFrom) {
        await writeMigratedDataDir(file);
        builtFrom = current;
      }
    } catch (error) {
      console.error("[db global-setup] migrations failed; fix them and rerun", error);
      builtFrom = undefined;
      await rm(file, { force: true }).catch(() => undefined);
    }
  });

  return removeDirectory;
}

/**
 * Every test loads this tarball into a new instance, and unpacking it is most
 * of what a test costs, so it carries as little as it can: a 1 MB WAL segment
 * instead of 16 MB, and no `template0` or `template1`, which no test creates a
 * database from. That takes it from 42 MB to under 18.
 */
async function writeMigratedDataDir(file: string) {
  const client = await PGlite.create({
    extensions: testExtensions,
    initDbStartParams: ["--wal-segsize=1"],
  });
  try {
    await migrate(drizzle(client), { migrationsFolder });
    // One statement per call: DROP DATABASE cannot run in the implicit
    // transaction a multi-statement `exec` opens.
    await client.query(
      "update pg_database set datistemplate = false where datname in ('template0', 'template1')",
    );
    await client.query("drop database template0");
    await client.query("drop database template1");
    await client.query("checkpoint");
    const dump = await client.dumpDataDir("none");
    await writeFile(file, Buffer.from(await dump.arrayBuffer()));
  } finally {
    await client.close();
  }
}

/** Every migration file's path, size and modification time, as one string. */
async function migrationsFingerprint() {
  const entries = await readdir(migrationsFolder, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const stamps = await Promise.all(
    files.map(async (entry) => {
      const full = path.join(entry.parentPath, entry.name);
      const info = await stat(full);
      return `${full}:${info.size}:${info.mtimeMs}`;
    }),
  );
  return stamps.sort().join("\n");
}
