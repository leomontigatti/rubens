import { describe, expect, it } from "vite-plus/test";

import type { OfficeInput } from "#/lib/offices.ts";

import {
  addMember,
  adminCaller,
  auditEntriesFor,
  setUpOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";

const centro = { name: "Sede Centro", address: "Av. Corrientes 1234" };
const missing = "00000000-0000-4000-8000-000000000000";

async function newOffice(organization: OrganizationStub, input: OfficeInput = centro) {
  const result = await organization.createOffice(adminCaller, input);
  if (!result.ok) {
    throw new Error(`createOffice refused: ${result.reason}`);
  }
  return result.office;
}

async function newRoom(organization: OrganizationStub, officeId: string, name = "Consultorio 1") {
  const result = await organization.createRoom(adminCaller, { officeId, name });
  if (!result.ok) {
    throw new Error(`createRoom refused: ${result.reason}`);
  }
  return result.room;
}

async function officeNames(organization: OrganizationStub, includeInactive: boolean) {
  const result = await organization.listOffices(adminCaller, { includeInactive });
  if (!result.ok) {
    throw new Error(`listOffices refused: ${result.reason}`);
  }
  return result.offices;
}

describe("offices", () => {
  it("creates an office, in Buenos Aires unless told otherwise", async () => {
    const { organization } = await setUpOrganization();

    const created = await newOffice(organization);
    const elsewhere = await newOffice(organization, {
      ...centro,
      name: "Sede Sur",
      timeZone: "America/Cordoba",
    });

    expect(created).toMatchObject({
      ...centro,
      timeZone: "America/Argentina/Buenos_Aires",
      active: true,
    });
    expect(elsewhere.timeZone).toBe("America/Cordoba");
    expect((await officeNames(organization, false)).map((office) => office.name)).toEqual([
      "Sede Centro",
      "Sede Sur",
    ]);
  });

  it("refuses a time zone that is not an IANA zone", async () => {
    const { organization } = await setUpOrganization();

    for (const timeZone of ["Buenos Aires", "-03:00"]) {
      expect(await organization.createOffice(adminCaller, { ...centro, timeZone })).toEqual({
        ok: false,
        reason: "invalidInput",
      });
    }
  });

  it("edits an office", async () => {
    const { organization } = await setUpOrganization();
    const created = await newOffice(organization);

    const result = await organization.updateOffice(adminCaller, {
      officeId: created.id,
      name: "Sede Norte",
      address: "Cabildo 1",
      timeZone: "UTC",
    });

    expect(result).toMatchObject({
      ok: true,
      office: { name: "Sede Norte", address: "Cabildo 1", timeZone: "UTC" },
    });
  });

  it("keeps the time zone when an edit leaves it out", async () => {
    const { organization } = await setUpOrganization();
    const created = await newOffice(organization, { ...centro, timeZone: "UTC" });

    const result = await organization.updateOffice(adminCaller, {
      officeId: created.id,
      name: "Sede Norte",
      address: "Cabildo 1",
    });

    expect(result).toMatchObject({ ok: true, office: { name: "Sede Norte", timeZone: "UTC" } });
  });

  it("drops a deactivated office from the default list, shows it on request, and reactivates it", async () => {
    const { organization } = await setUpOrganization();
    const created = await newOffice(organization);

    await organization.setOfficeActive(adminCaller, { id: created.id, active: false });
    const active = await officeNames(organization, false);
    const all = await officeNames(organization, true);
    await organization.setOfficeActive(adminCaller, { id: created.id, active: true });

    expect(active).toEqual([]);
    expect(all).toMatchObject([{ id: created.id, active: false }]);
    expect(await officeNames(organization, false)).toMatchObject([
      { id: created.id, active: true },
    ]);
  });

  it("answers notFound for an office that does not exist", async () => {
    const { organization } = await setUpOrganization();

    expect(await organization.updateOffice(adminCaller, { ...centro, officeId: missing })).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await organization.setOfficeActive(adminCaller, { id: missing, active: false })).toEqual(
      { ok: false, reason: "notFound" },
    );
    expect(
      await organization.getOffice(adminCaller, { officeId: missing, includeInactive: true }),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("rooms", () => {
  it("creates a room in an office with a capacity of 1 unless told otherwise", async () => {
    const { organization } = await setUpOrganization();
    const created = await newOffice(organization);
    await newRoom(organization, created.id);
    await organization.createRoom(adminCaller, {
      officeId: created.id,
      name: "Consultorio 2",
      capacity: 2,
    });

    const result = await organization.getOffice(adminCaller, {
      officeId: created.id,
      includeInactive: false,
    });

    expect(result).toMatchObject({
      ok: true,
      office: { id: created.id },
      rooms: [
        { name: "Consultorio 1", capacity: 1, active: true },
        { name: "Consultorio 2", capacity: 2, active: true },
      ],
    });
  });

  it("answers notFound for a room in an office that does not exist", async () => {
    const { organization } = await setUpOrganization();

    expect(
      await organization.createRoom(adminCaller, { officeId: missing, name: "Consultorio" }),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(
      await organization.updateRoom(adminCaller, { roomId: missing, name: "Consultorio" }),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(await organization.setRoomActive(adminCaller, { id: missing, active: false })).toEqual({
      ok: false,
      reason: "notFound",
    });
  });

  it("refuses a new room in a deactivated office, and adds none", async () => {
    const { organization } = await setUpOrganization();
    const created = await newOffice(organization);
    await organization.setOfficeActive(adminCaller, { id: created.id, active: false });

    const result = await organization.createRoom(adminCaller, {
      officeId: created.id,
      name: "Consultorio 1",
    });

    expect(result).toEqual({ ok: false, reason: "officeInactive" });
    expect(
      await organization.getOffice(adminCaller, { officeId: created.id, includeInactive: true }),
    ).toMatchObject({ ok: true, rooms: [] });
  });

  it("edits a room", async () => {
    const { organization } = await setUpOrganization();
    const room = await newRoom(organization, (await newOffice(organization)).id);

    const result = await organization.updateRoom(adminCaller, {
      roomId: room.id,
      name: "Consultorio A",
      capacity: 3,
    });

    expect(result).toMatchObject({ ok: true, room: { name: "Consultorio A", capacity: 3 } });
  });

  it("keeps the capacity when an edit leaves it out", async () => {
    const { organization } = await setUpOrganization();
    const room = await newRoom(organization, (await newOffice(organization)).id);
    await organization.updateRoom(adminCaller, { roomId: room.id, name: "A", capacity: 3 });

    const result = await organization.updateRoom(adminCaller, {
      roomId: room.id,
      name: "Consultorio A",
    });

    expect(result).toMatchObject({ ok: true, room: { name: "Consultorio A", capacity: 3 } });
  });

  it("drops a deactivated room from the office's default list, shows it on request, and reactivates it", async () => {
    const { organization } = await setUpOrganization();
    const office = await newOffice(organization);
    const room = await newRoom(organization, office.id);
    const detail = (includeInactive: boolean) =>
      organization.getOffice(adminCaller, { officeId: office.id, includeInactive });

    await organization.setRoomActive(adminCaller, { id: room.id, active: false });
    const active = await detail(false);
    const all = await detail(true);
    await organization.setRoomActive(adminCaller, { id: room.id, active: true });

    expect(active).toMatchObject({ ok: true, rooms: [] });
    expect(all).toMatchObject({ ok: true, rooms: [{ id: room.id, active: false }] });
    expect(await detail(false)).toMatchObject({
      ok: true,
      rooms: [{ id: room.id, active: true }],
    });
  });
});

describe("roles", () => {
  it("lets receptionists and practitioners see offices and rooms", async () => {
    const { organization } = await setUpOrganization();
    const office = await newOffice(organization);
    await newRoom(organization, office.id);

    for (const roles of [["receptionist"], ["practitioner"]] as const) {
      const caller = await addMember(organization, [...roles]);
      const listed = await organization.listOffices(caller, { includeInactive: false });
      const detail = await organization.getOffice(caller, {
        officeId: office.id,
        includeInactive: false,
      });
      expect(listed).toMatchObject({ ok: true, offices: [{ id: office.id }] });
      expect(detail).toMatchObject({ ok: true, rooms: [{ name: "Consultorio 1" }] });
    }
  });

  it("refuses every change to anyone without the admin role, and changes nothing", async () => {
    const { organization } = await setUpOrganization();
    const office = await newOffice(organization);
    const room = await newRoom(organization, office.id);
    const nonAdmin = await addMember(organization, ["receptionist", "practitioner"]);

    const results = [
      await organization.createOffice(nonAdmin, centro),
      await organization.updateOffice(nonAdmin, { ...centro, name: "X", officeId: office.id }),
      await organization.setOfficeActive(nonAdmin, { id: office.id, active: false }),
      await organization.createRoom(nonAdmin, { officeId: office.id, name: "X" }),
      await organization.updateRoom(nonAdmin, { roomId: room.id, name: "X", capacity: 1 }),
      await organization.setRoomActive(nonAdmin, { id: room.id, active: false }),
    ];

    for (const result of results) {
      expect(result).toEqual({ ok: false, reason: "forbidden" });
    }
    expect(
      await organization.getOffice(adminCaller, { officeId: office.id, includeInactive: true }),
    ).toMatchObject({
      ok: true,
      office: { name: "Sede Centro", active: true },
      rooms: [{ name: "Consultorio 1", active: true }],
    });
  });
});

describe("auditing offices and rooms", () => {
  it("records an office's creation, each edit that changes it, and its deactivation", async () => {
    const { organization } = await setUpOrganization();
    const office = await newOffice(organization);
    await organization.updateOffice(adminCaller, { ...centro, officeId: office.id });
    await organization.updateOffice(adminCaller, {
      officeId: office.id,
      name: "Sede Norte",
      address: centro.address,
    });
    await organization.setOfficeActive(adminCaller, { id: office.id, active: false });
    // Already inactive: nothing changes, nothing is written.
    await organization.setOfficeActive(adminCaller, { id: office.id, active: false });
    await organization.setOfficeActive(adminCaller, { id: office.id, active: true });

    const about = { entityType: "office", userId: adminCaller.userId, patientId: null };
    expect(await auditEntriesFor(organization, office.id)).toEqual([
      {
        ...about,
        action: "create",
        before: null,
        after: { ...centro, timeZone: "America/Argentina/Buenos_Aires" },
      },
      {
        ...about,
        action: "update",
        before: { name: "Sede Centro" },
        after: { name: "Sede Norte" },
      },
      { ...about, action: "deactivate", before: { active: true }, after: { active: false } },
      { ...about, action: "reactivate", before: { active: false }, after: { active: true } },
    ]);
  });

  it("records a room's creation, its edit and its deactivation", async () => {
    const { organization } = await setUpOrganization();
    const office = await newOffice(organization);
    const room = await newRoom(organization, office.id);
    await organization.updateRoom(adminCaller, {
      roomId: room.id,
      name: "Consultorio 1",
      capacity: 2,
    });
    await organization.setRoomActive(adminCaller, { id: room.id, active: false });

    const about = { entityType: "room", userId: adminCaller.userId, patientId: null };
    expect(await auditEntriesFor(organization, room.id)).toEqual([
      {
        ...about,
        action: "create",
        before: null,
        after: { officeId: office.id, name: "Consultorio 1", capacity: 1 },
      },
      { ...about, action: "update", before: { capacity: 1 }, after: { capacity: 2 } },
      { ...about, action: "deactivate", before: { active: true }, after: { active: false } },
    ]);
  });
});
