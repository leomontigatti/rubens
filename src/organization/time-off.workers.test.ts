import { describe, expect, it } from "vite-plus/test";

import type { RangeEntry } from "#/lib/time-ranges.ts";

import {
  addStaff,
  adminCaller,
  auditEntriesFor,
  inStorage,
  setUpOrganization,
} from "#/organization/organization.test-support.ts";
import { timeOff } from "#/organization/schema.ts";

// Time off is read in the organization's default zone, Buenos Aires (UTC-3).

type Caller = typeof adminCaller;

const vacation: RangeEntry = { kind: "days", firstDate: "2099-01-05", lastDate: "2099-01-09" };
const afternoon: RangeEntry = { kind: "hours", start: "2099-01-12T14:00", end: "2099-01-12T18:00" };

async function world() {
  const { organization } = await setUpOrganization();
  const juan = await addStaff(organization, "Juan Gómez");

  const create = (caller: Caller, entry: RangeEntry, practitionerId = juan.practitionerId) =>
    organization.createTimeOff(caller, { practitionerId, entry });

  async function createdId(caller: Caller, entry: RangeEntry, practitionerId?: string) {
    const result = await create(caller, entry, practitionerId);
    if (!result.ok) {
      throw new Error(`createTimeOff refused: ${result.reason}`);
    }
    return result.timeOff.id;
  }

  async function list(caller: Caller) {
    const result = await organization.listTimeOff(caller);
    if (!result.ok) {
      throw new Error(`listTimeOff refused: ${result.reason}`);
    }
    return result;
  }

  /** The stored spans, as instants. */
  const storedSpans = () =>
    inStorage(organization, (database) =>
      database
        .select({ startsAt: timeOff.startsAt, endsAt: timeOff.endsAt })
        .from(timeOff)
        .all()
        .map((row) => [new Date(row.startsAt).toISOString(), new Date(row.endsAt).toISOString()]),
    );

  return { organization, juan, create, createdId, list, storedSpans };
}

describe("recording time off", () => {
  it("stores whole days from local midnight to the midnight after the last day, audited", async () => {
    const { organization, juan, create, list, storedSpans } = await world();

    const result = await create(adminCaller, vacation);

    expect(result).toMatchObject({ ok: true });
    expect(await storedSpans()).toEqual([["2099-01-05T03:00:00.000Z", "2099-01-10T03:00:00.000Z"]]);
    expect((await list(adminCaller)).timeOff).toEqual([
      expect.objectContaining({
        practitionerId: juan.practitionerId,
        practitionerName: "Juan Gómez",
        entry: vacation,
      }),
    ]);
    expect(await auditEntriesFor(organization, result.ok ? result.timeOff.id : "")).toEqual([
      {
        action: "create",
        entityType: "timeOff",
        userId: adminCaller.userId,
        patientId: null,
        before: null,
        after: {
          practitionerId: juan.practitionerId,
          startsAt: Date.parse("2099-01-05T03:00:00Z"),
          endsAt: Date.parse("2099-01-10T03:00:00Z"),
        },
      },
    ]);
  });

  it("stores a range of hours as the local times entered", async () => {
    const { create, storedSpans } = await world();

    await create(adminCaller, afternoon);

    expect(await storedSpans()).toEqual([["2099-01-12T17:00:00.000Z", "2099-01-12T21:00:00.000Z"]]);
  });

  it("allows time off that overlaps other time off", async () => {
    const { create } = await world();
    await create(adminCaller, vacation);

    expect(
      await create(adminCaller, { kind: "days", firstDate: "2099-01-07", lastDate: "2099-01-07" }),
    ).toMatchObject({ ok: true });
  });

  it.each<[string, RangeEntry]>([
    ["hours ending before they start", { ...afternoon, end: "2099-01-12T13:00" } as RangeEntry],
    ["hours ending as they start", { ...afternoon, end: afternoon.start } as RangeEntry],
    ["a last day before the first", { ...vacation, lastDate: "2099-01-04" } as RangeEntry],
  ])("refuses %s", async (_, entry) => {
    const { create, storedSpans } = await world();

    expect(await create(adminCaller, entry)).toEqual({ ok: false, reason: "invalidInput" });
    expect(await storedSpans()).toEqual([]);
  });

  it("refuses a practitioner that does not exist", async () => {
    const { create } = await world();

    expect(await create(adminCaller, vacation, crypto.randomUUID())).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("who records time off", () => {
  it("lets a practitioner record their own", async () => {
    const { juan, create } = await world();

    expect(await create(juan.caller, vacation)).toMatchObject({ ok: true });
  });

  it("refuses a practitioner another practitioner's time off", async () => {
    const { organization, juan, create } = await world();
    const lucia = await addStaff(organization, "Lucía Díaz");

    expect(await create(juan.caller, vacation, lucia.practitionerId)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("refuses a receptionist, who still reads everyone's time off", async () => {
    const { organization, juan, create, list } = await world();
    const rosa = await addStaff(organization, "Rosa Paz", ["receptionist"]);
    await create(adminCaller, vacation);

    expect(await create(rosa.caller, afternoon)).toEqual({ ok: false, reason: "forbidden" });
    expect(await list(rosa.caller)).toMatchObject({
      timeOff: [{ practitionerId: juan.practitionerId, canEdit: false }],
      practitioners: [],
    });
  });

  it("offers a practitioner only themself, and marks only their own as editable", async () => {
    const { organization, juan, create, list } = await world();
    const lucia = await addStaff(organization, "Lucía Díaz");
    await create(adminCaller, vacation, lucia.practitionerId);
    await create(adminCaller, afternoon);

    const seen = await list(juan.caller);
    expect(seen.practitioners).toEqual([{ id: juan.practitionerId, displayName: "Juan Gómez" }]);
    expect(seen.timeOff.map((row) => [row.practitionerName, row.canEdit])).toEqual([
      ["Juan Gómez", true],
      ["Lucía Díaz", false],
    ]);
  });
});

describe("editing and deleting time off", () => {
  it("replaces the range, audited", async () => {
    const { organization, juan, createdId, list } = await world();
    const id = await createdId(juan.caller, vacation);

    expect(
      await organization.updateTimeOff(juan.caller, { timeOffId: id, entry: afternoon }),
    ).toEqual({ ok: true });
    expect((await list(adminCaller)).timeOff).toEqual([
      expect.objectContaining({ id, entry: afternoon }),
    ]);
    expect((await auditEntriesFor(organization, id)).at(-1)).toEqual({
      action: "update",
      entityType: "timeOff",
      userId: juan.caller.userId,
      patientId: null,
      before: {
        startsAt: Date.parse("2099-01-05T03:00:00Z"),
        endsAt: Date.parse("2099-01-10T03:00:00Z"),
      },
      after: {
        startsAt: Date.parse("2099-01-12T17:00:00Z"),
        endsAt: Date.parse("2099-01-12T21:00:00Z"),
      },
    });
  });

  it("deletes it, audited", async () => {
    const { organization, juan, createdId, storedSpans } = await world();
    const id = await createdId(adminCaller, vacation);

    expect(await organization.deleteTimeOff(juan.caller, { timeOffId: id })).toEqual({ ok: true });
    expect(await storedSpans()).toEqual([]);
    expect((await auditEntriesFor(organization, id)).at(-1)).toMatchObject({
      action: "delete",
      userId: juan.caller.userId,
      before: { practitionerId: juan.practitionerId },
      after: null,
    });
  });

  it("refuses another practitioner and a receptionist", async () => {
    const { organization, juan, createdId, storedSpans } = await world();
    const lucia = await addStaff(organization, "Lucía Díaz");
    const id = await createdId(adminCaller, vacation, lucia.practitionerId);
    const rosa = await addStaff(organization, "Rosa Paz", ["receptionist"]);

    for (const caller of [juan.caller, rosa.caller]) {
      expect(await organization.updateTimeOff(caller, { timeOffId: id, entry: afternoon })).toEqual(
        {
          ok: false,
          reason: "forbidden",
        },
      );
      expect(await organization.deleteTimeOff(caller, { timeOffId: id })).toEqual({
        ok: false,
        reason: "forbidden",
      });
    }
    expect(await storedSpans()).toHaveLength(1);
  });

  it("refuses time off that does not exist", async () => {
    const { organization } = await world();

    expect(
      await organization.deleteTimeOff(adminCaller, { timeOffId: crypto.randomUUID() }),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});
