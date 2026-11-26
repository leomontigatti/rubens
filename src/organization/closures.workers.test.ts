import { describe, expect, it } from "vite-plus/test";

import type { RangeEntry } from "#/lib/time-ranges.ts";

import {
  addOffice,
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
  const norte = await addOffice(organization, "Sede Norte");

  async function createdId(officeId: string | null, entry: RangeEntry) {
    const result = await organization.createClosure(adminCaller, { officeId, entry });
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
      database
        .select({ officeId: closure.officeId, startsAt: closure.startsAt, endsAt: closure.endsAt })
        .from(closure)
        .all(),
    );

  return { organization, norte, createdId, list, stored };
}

describe("creating a closure", () => {
  it("reads an office's whole days in the practice's zone, audited", async () => {
    const { organization, norte, createdId, list, stored } = await world();

    const id = await createdId(norte.id, holiday);

    expect(await stored()).toEqual([{ officeId: norte.id, ...holidayInstants }]);
    expect((await list()).closures).toEqual([
      expect.objectContaining({ officeId: norte.id, officeName: "Sede Norte", entry: holiday }),
    ]);
    expect(await auditEntriesFor(organization, id)).toEqual([
      {
        action: "create",
        entityType: "closure",
        userId: adminCaller.userId,
        patientId: null,
        before: null,
        after: { officeId: norte.id, ...holidayInstants },
      },
    ]);
  });

  it("reads the whole organization's closure in the practice's zone", async () => {
    const { createdId, list, stored } = await world();

    await createdId(null, fridayAfternoon);

    expect(await stored()).toEqual([
      {
        officeId: null,
        startsAt: Date.parse("2099-01-09T17:00:00Z"),
        endsAt: Date.parse("2099-01-10T03:00:00Z"),
      },
    ]);
    expect((await list()).closures).toEqual([
      expect.objectContaining({ officeId: null, officeName: null, entry: fridayAfternoon }),
    ]);
  });

  it("allows closures that overlap", async () => {
    const { organization, norte, createdId } = await world();
    await createdId(null, holiday);

    for (let time = 0; time < 2; time += 1) {
      expect(
        await organization.createClosure(adminCaller, { officeId: norte.id, entry: holiday }),
      ).toMatchObject({ ok: true });
    }
  });

  it("refuses hours that do not start before they end", async () => {
    const { organization } = await world();

    expect(
      await organization.createClosure(adminCaller, {
        officeId: null,
        entry: { ...fridayAfternoon, end: "2099-01-09T14:00" },
      }),
    ).toEqual({ ok: false, reason: "invalidInput" });
  });

  it("refuses an office that does not exist", async () => {
    const { organization } = await world();

    expect(
      await organization.createClosure(adminCaller, {
        officeId: crypto.randomUUID(),
        entry: holiday,
      }),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("who changes closures", () => {
  it("refuses everyone but admins, who all still read them", async () => {
    const { organization, norte, createdId, list, stored } = await world();
    const juan = await addStaff(organization, "Juan Gómez");
    const rosa = await addStaff(organization, "Rosa Paz", ["receptionist"]);
    const id = await createdId(norte.id, holiday);
    const forbidden = { ok: false, reason: "forbidden" };

    for (const { caller } of [juan, rosa]) {
      expect(await organization.createClosure(caller, { officeId: null, entry: holiday })).toEqual(
        forbidden,
      );
      expect(
        await organization.updateClosure(caller, { closureId: id, officeId: null, entry: holiday }),
      ).toEqual(forbidden);
      expect(await organization.deleteClosure(caller, { closureId: id })).toEqual(forbidden);
      expect(await list(caller)).toMatchObject({ canEdit: false, closures: [{ id }] });
    }
    expect(await list()).toMatchObject({ canEdit: true });
    expect(await stored()).toHaveLength(1);
  });
});

describe("editing and deleting a closure", () => {
  it("moves it to another office, audited", async () => {
    const { organization, norte, createdId, stored } = await world();
    const id = await createdId(null, holiday);

    expect(
      await organization.updateClosure(adminCaller, {
        closureId: id,
        officeId: norte.id,
        entry: holiday,
      }),
    ).toEqual({ ok: true });
    expect(await stored()).toEqual([{ officeId: norte.id, ...holidayInstants }]);
    expect((await auditEntriesFor(organization, id)).at(-1)).toEqual({
      action: "update",
      entityType: "closure",
      userId: adminCaller.userId,
      patientId: null,
      before: { officeId: null },
      after: { officeId: norte.id },
    });
  });

  it("deletes it, audited", async () => {
    const { organization, norte, createdId, stored } = await world();
    const id = await createdId(norte.id, holiday);

    expect(await organization.deleteClosure(adminCaller, { closureId: id })).toEqual({ ok: true });
    expect(await stored()).toEqual([]);
    expect((await auditEntriesFor(organization, id)).at(-1)).toMatchObject({
      action: "delete",
      before: { officeId: norte.id, ...holidayInstants },
      after: null,
    });
  });

  it("refuses a closure that does not exist", async () => {
    const { organization } = await world();
    const missing = crypto.randomUUID();

    expect(
      await organization.updateClosure(adminCaller, {
        closureId: missing,
        officeId: null,
        entry: holiday,
      }),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(await organization.deleteClosure(adminCaller, { closureId: missing })).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});
