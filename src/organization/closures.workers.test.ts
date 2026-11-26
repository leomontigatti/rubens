import { describe, expect, it } from "vite-plus/test";

import type { RangeEntry } from "#/lib/time-ranges.ts";

import {
  addStaff,
  adminCaller,
  auditEntriesFor,
  inStorage,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import { closure } from "#/organization/schema.ts";

// Every closure is read in the practice's zone, Buenos Aires (UTC-3).

const holiday: RangeEntry = { kind: "days", firstDate: "2099-01-06", lastDate: "2099-01-06" };
const fridayAfternoon: RangeEntry = {
  kind: "hours",
  start: "2099-01-09T14:00",
  end: "2099-01-10T00:00",
};

/** 2099-01-06, as instants. */
const holidayInstants = {
  startsAt: Date.parse("2099-01-06T03:00:00Z"),
  endsAt: Date.parse("2099-01-07T03:00:00Z"),
};

async function world() {
  const { organization } = await setUpTestOrganization();

  async function createdId(entry: RangeEntry) {
    const result = await organization.createClosure(adminCaller, { entry });
    if (!result.ok) {
      throw new Error(`createClosure refused: ${result.reason}`);
    }
    return result.closure.id;
  }

  async function list(caller: typeof adminCaller = adminCaller) {
    const result = await organization.listClosures(caller);
    if (!result.ok) {
      throw new Error(`listClosures refused: ${result.reason}`);
    }
    return result;
  }

  const stored = () =>
    inStorage(organization, (database) =>
      database.select({ startsAt: closure.startsAt, endsAt: closure.endsAt }).from(closure).all(),
    );

  return { organization, createdId, list, stored };
}

describe("creating a closure", () => {
  it("reads whole days in the practice's zone, audited", async () => {
    const { organization, createdId, list, stored } = await world();

    const id = await createdId(holiday);

    expect(await stored()).toEqual([holidayInstants]);
    expect((await list()).closures).toEqual([{ id, entry: holiday }]);
    expect(await auditEntriesFor(organization, id)).toEqual([
      {
        action: "create",
        entityType: "closure",
        userId: adminCaller.userId,
        patientId: null,
        before: null,
        after: holidayInstants,
      },
    ]);
  });

  it("reads hours in the practice's zone", async () => {
    const { createdId, list, stored } = await world();

    const id = await createdId(fridayAfternoon);

    expect(await stored()).toEqual([
      {
        startsAt: Date.parse("2099-01-09T17:00:00Z"),
        endsAt: Date.parse("2099-01-10T03:00:00Z"),
      },
    ]);
    expect((await list()).closures).toEqual([{ id, entry: fridayAfternoon }]);
  });

  it("allows closures that overlap", async () => {
    const { organization, createdId } = await world();
    await createdId(holiday);

    expect(await organization.createClosure(adminCaller, { entry: holiday })).toMatchObject({
      ok: true,
    });
  });

  it("refuses hours that do not start before they end", async () => {
    const { organization } = await world();

    expect(
      await organization.createClosure(adminCaller, {
        entry: { ...fridayAfternoon, end: "2099-01-09T14:00" },
      }),
    ).toEqual({ ok: false, reason: "invalidInput" });
  });
});

describe("who changes closures", () => {
  it("refuses everyone but admins, who all still read them", async () => {
    const { organization, createdId, list, stored } = await world();
    const juan = await addStaff(organization, "Juan Gómez");
    const rosa = await addStaff(organization, "Rosa Paz", ["receptionist"]);
    const id = await createdId(holiday);
    const forbidden = { ok: false, reason: "forbidden" };

    for (const { caller } of [juan, rosa]) {
      expect(await organization.createClosure(caller, { entry: holiday })).toEqual(forbidden);
      expect(await organization.updateClosure(caller, { closureId: id, entry: holiday })).toEqual(
        forbidden,
      );
      expect(await organization.deleteClosure(caller, { closureId: id })).toEqual(forbidden);
      expect(await list(caller)).toMatchObject({ canEdit: false, closures: [{ id }] });
    }
    expect(await list()).toMatchObject({ canEdit: true });
    expect(await stored()).toHaveLength(1);
  });
});

describe("editing and deleting a closure", () => {
  it("moves it to other hours, audited", async () => {
    const { organization, createdId, stored } = await world();
    const id = await createdId(fridayAfternoon);

    expect(
      await organization.updateClosure(adminCaller, { closureId: id, entry: holiday }),
    ).toEqual({ ok: true });
    expect(await stored()).toEqual([holidayInstants]);
    expect((await auditEntriesFor(organization, id)).at(-1)).toEqual({
      action: "update",
      entityType: "closure",
      userId: adminCaller.userId,
      patientId: null,
      before: {
        startsAt: Date.parse("2099-01-09T17:00:00Z"),
        endsAt: Date.parse("2099-01-10T03:00:00Z"),
      },
      after: holidayInstants,
    });
  });

  it("deletes it, audited", async () => {
    const { organization, createdId, stored } = await world();
    const id = await createdId(holiday);

    expect(await organization.deleteClosure(adminCaller, { closureId: id })).toEqual({ ok: true });
    expect(await stored()).toEqual([]);
    expect((await auditEntriesFor(organization, id)).at(-1)).toMatchObject({
      action: "delete",
      before: holidayInstants,
      after: null,
    });
  });

  it("refuses a closure that does not exist", async () => {
    const { organization } = await world();
    const missing = crypto.randomUUID();

    expect(
      await organization.updateClosure(adminCaller, {
        closureId: missing,
        entry: holiday,
      }),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(await organization.deleteClosure(adminCaller, { closureId: missing })).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});
