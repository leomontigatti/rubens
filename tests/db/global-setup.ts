import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { TestProject } from "vite-plus/test/node";

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
 */
export default async function setup(project: TestProject) {
  const client = await PGlite.create({ extensions: { btree_gist } });
  await migrate(drizzle(client), { migrationsFolder });
  const dump = await client.dumpDataDir("none");
  await client.close();

  const directory = await mkdtemp(path.join(tmpdir(), "rubens-pglite-"));
  const file = path.join(directory, "migrated.tar");
  await writeFile(file, Buffer.from(await dump.arrayBuffer()));
  project.provide(migratedDataDirKey, file as never);

  return async () => {
    await rm(directory, { recursive: true, force: true });
  };
}
