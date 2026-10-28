import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { closure } from "#/db/schema/index.ts";
import type { Actor } from "#/lib/access.ts";
import type { RangeEntry } from "#/lib/time-ranges.ts";
import { createSchedulingWorld } from "#/test-support/scheduling.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { createClosure, deleteClosure, listClosures, updateClosure } from "#/server/closures.ts";

// Every service call runs as the app role. An office's closure is read in its
// office's zone; Madrid (UTC+1 in January) tells it apart from the
// organization's default, Buenos Aires (UTC-3).

let client: PGlite;
let db: TestDatabase;
let world: Awaited<ReturnType<typeof createSchedulingWorld>>;
let madridId: string;

const holiday: RangeEntry = { kind: "days", firstDate: "2099-01-06", lastDate: "2099-01-06" };
const fridayAfternoon: RangeEntry = {
  kind: "hours",
  start: "2099-01-09T14:00",
  end: "2099-01-10T00:00",
};

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  world = await createSchedulingWorld(db);
  madridId = (await world.addOffice("Sede Madrid", "Europe/Madrid")).id;
});

afterEach(async () => {
  await client.close();
});

function create(actor: Actor, officeId: string | null, entry: RangeEntry) {
  return asAppRole(db, (tx) => createClosure(actor, { officeId, entry }, tx));
}

async function createdId(officeId: string | null, entry: RangeEntry) {
  const result = await create(world.admin, officeId, entry);
  if (!result.ok) {
    throw new Error(`createClosure failed: ${result.reason}`);
  }
  return result.closure.id;
}

function list(actor: Actor) {
  return asAppRole(db, (tx) => listClosures(actor, tx));
}

/** The stored rows, read as the owner. */
async function stored() {
  const rows = await db.select().from(closure);
  return rows.map((row) => ({ officeId: row.officeId, during: row.during }));
}

describe("creating a closure", () => {
  it("reads an office's whole days in the office's zone", async () => {
    expect(await create(world.admin, madridId, holiday)).toMatchObject({ ok: true });

    expect(await stored()).toEqual([
      {
        officeId: madridId,
        during: { start: new Date("2099-01-05T23:00:00Z"), end: new Date("2099-01-06T23:00:00Z") },
      },
    ]);
    expect((await list(world.admin)).closures).toEqual([
      expect.objectContaining({ officeId: madridId, officeName: "Sede Madrid", entry: holiday }),
    ]);
  });

  it("reads the whole organization's closure in the organization's default zone", async () => {
    await create(world.admin, null, fridayAfternoon);

    expect(await stored()).toEqual([
      {
        officeId: null,
        during: { start: new Date("2099-01-09T17:00:00Z"), end: new Date("2099-01-10T03:00:00Z") },
      },
    ]);
    expect((await list(world.admin)).closures).toEqual([
      expect.objectContaining({ officeId: null, officeName: null, entry: fridayAfternoon }),
    ]);
  });

  it("allows closures that overlap", async () => {
    await create(world.admin, null, holiday);

    expect(await create(world.admin, madridId, holiday)).toMatchObject({ ok: true });
    expect(await create(world.admin, madridId, holiday)).toMatchObject({ ok: true });
  });

  it("refuses hours that do not start before they end", async () => {
    expect(
      await create(world.admin, null, {
        ...fridayAfternoon,
        end: "2099-01-09T14:00",
      } as RangeEntry),
    ).toEqual({ ok: false, reason: "invalidInput" });
  });

  it("refuses an office that does not exist", async () => {
    expect(await create(world.admin, crypto.randomUUID(), holiday)).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("who changes closures", () => {
  it("refuses everyone but admins, who all still read them", async () => {
    const { actor: practitioner } = await world.addStaff("Juan Gómez");
    const { actor: receptionist } = await world.addStaff("Rosa Paz", ["receptionist"]);
    const id = await createdId(madridId, holiday);

    for (const actor of [practitioner, receptionist]) {
      expect(await create(actor, null, holiday)).toEqual({ ok: false, reason: "forbidden" });
      expect(
        await asAppRole(db, (tx) =>
          updateClosure(actor, { closureId: id, officeId: null, entry: holiday }, tx),
        ),
      ).toEqual({ ok: false, reason: "forbidden" });
      expect(await asAppRole(db, (tx) => deleteClosure(actor, { closureId: id }, tx))).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect(await list(actor)).toMatchObject({ canEdit: false, closures: [{ id }] });
    }
    expect(await stored()).toHaveLength(1);
  });
});

describe("editing and deleting a closure", () => {
  it("moves it to another office and range, read in the new office's zone", async () => {
    const id = await createdId(null, holiday);

    expect(
      await asAppRole(db, (tx) =>
        updateClosure(world.admin, { closureId: id, officeId: madridId, entry: holiday }, tx),
      ),
    ).toEqual({ ok: true });
    expect(await stored()).toEqual([
      {
        officeId: madridId,
        during: { start: new Date("2099-01-05T23:00:00Z"), end: new Date("2099-01-06T23:00:00Z") },
      },
    ]);
  });

  it("deletes it", async () => {
    const id = await createdId(madridId, holiday);

    expect(await asAppRole(db, (tx) => deleteClosure(world.admin, { closureId: id }, tx))).toEqual({
      ok: true,
    });
    expect(await stored()).toEqual([]);
  });

  it("refuses a closure that does not exist", async () => {
    expect(
      await asAppRole(db, (tx) =>
        updateClosure(
          world.admin,
          { closureId: crypto.randomUUID(), officeId: null, entry: holiday },
          tx,
        ),
      ),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});
