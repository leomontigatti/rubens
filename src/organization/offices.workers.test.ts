import { describe, expect, it } from "vite-plus/test";

import {
  addMember,
  adminCaller,
  auditEntriesFor,
  setUpTestOrganization,
  theOffice,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";

const centro = { name: "Sede Centro", address: "Av. Colón 100" };
const missing = "00000000-0000-4000-8000-000000000000";

async function newRoom(organization: OrganizationStub, officeId: string, name = "Consultorio 1") {
  const result = await organization.createRoom(adminCaller, { officeId, name });
  if (!result.ok) {
    throw new Error(`createRoom refused: ${result.reason}`);
  }
  return result.room;
}

describe("offices", () => {
  it("edits an office", async () => {
    const { organization } = await setUpTestOrganization();
    const created = await theOffice(organization);

    const result = await organization.updateOffice(adminCaller, {
      officeId: created.id,
      name: "Sede Norte",
      address: "Cabildo 1",
    });

    expect(result).toMatchObject({
      ok: true,
      office: { name: "Sede Norte", address: "Cabildo 1" },
    });
  });

  it("answers notFound for an office that does not exist", async () => {
    const { organization } = await setUpTestOrganization();

    expect(await organization.updateOffice(adminCaller, { ...centro, officeId: missing })).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("rooms", () => {
  it("creates rooms in an office", async () => {
    const { organization } = await setUpTestOrganization();
    const created = await theOffice(organization);
    await newRoom(organization, created.id);
    await organization.createRoom(adminCaller, { officeId: created.id, name: "Consultorio 2" });

    const result = await organization.getOffice(adminCaller, { includeInactive: false });

    expect(result).toMatchObject({
      ok: true,
      office: { id: created.id },
      rooms: [
        { name: "Consultorio 1", active: true },
        { name: "Consultorio 2", active: true },
      ],
    });
  });

  it("answers notFound for a room in an office that does not exist", async () => {
    const { organization } = await setUpTestOrganization();

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

  it("edits a room", async () => {
    const { organization } = await setUpTestOrganization();
    const room = await newRoom(organization, (await theOffice(organization)).id);

    const result = await organization.updateRoom(adminCaller, {
      roomId: room.id,
      name: "Consultorio A",
    });

    expect(result).toMatchObject({ ok: true, room: { name: "Consultorio A" } });
  });

  it("drops a deactivated room from the office's default list, shows it on request, and reactivates it", async () => {
    const { organization } = await setUpTestOrganization();
    const office = await theOffice(organization);
    const room = await newRoom(organization, office.id);
    const detail = (includeInactive: boolean) =>
      organization.getOffice(adminCaller, { includeInactive });

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

  it("says when the office's default room list is empty only because every room is inactive", async () => {
    const { organization } = await setUpTestOrganization();
    const office = await theOffice(organization);
    const rooms = (includeInactive: boolean) =>
      organization.getOffice(adminCaller, { includeInactive });
    const none = await rooms(false);
    const room = await newRoom(organization, office.id);
    await organization.setRoomActive(adminCaller, { id: room.id, active: false });

    expect(none).toMatchObject({ ok: true, rooms: [], onlyInactive: false });
    expect(await rooms(false)).toMatchObject({ ok: true, rooms: [], onlyInactive: true });
    expect(await rooms(true)).toMatchObject({ ok: true, onlyInactive: false });
  });
});

describe("roles", () => {
  it("lets receptionists and practitioners see offices and rooms", async () => {
    const { organization } = await setUpTestOrganization();
    const office = await theOffice(organization);
    await newRoom(organization, office.id);

    for (const roles of [["receptionist"], ["practitioner"]] as const) {
      const caller = await addMember(organization, [...roles]);
      const listed = await organization.listOffices(caller);
      const detail = await organization.getOffice(caller, { includeInactive: false });
      expect(listed).toEqual({ ok: true, offices: [office] });
      expect(detail).toMatchObject({
        ok: true,
        office: { id: office.id },
        rooms: [{ name: "Consultorio 1" }],
      });
    }
  });

  it("refuses every change to anyone without the admin role, and changes nothing", async () => {
    const { organization } = await setUpTestOrganization();
    const office = await theOffice(organization);
    const room = await newRoom(organization, office.id);
    const nonAdmin = await addMember(organization, ["receptionist", "practitioner"]);

    const results = [
      await organization.updateOffice(nonAdmin, { ...centro, name: "X", officeId: office.id }),
      await organization.createRoom(nonAdmin, { officeId: office.id, name: "X" }),
      await organization.updateRoom(nonAdmin, { roomId: room.id, name: "X" }),
      await organization.setRoomActive(nonAdmin, { id: room.id, active: false }),
    ];

    for (const result of results) {
      expect(result).toEqual({ ok: false, reason: "forbidden" });
    }
    expect(await organization.getOffice(adminCaller, { includeInactive: true })).toMatchObject({
      ok: true,
      office: { name: "Sede Centro", active: true },
      rooms: [{ name: "Consultorio 1", active: true }],
    });
  });
});

describe("auditing offices and rooms", () => {
  it("records the office's creation at setup, and each edit that changes it", async () => {
    const { organization } = await setUpTestOrganization();
    const office = await theOffice(organization);
    await organization.updateOffice(adminCaller, { ...centro, officeId: office.id });
    await organization.updateOffice(adminCaller, {
      officeId: office.id,
      name: "Sede Norte",
      address: centro.address,
    });

    const about = { entityType: "office", userId: adminCaller.userId, patientId: null };
    expect(await auditEntriesFor(organization, office.id)).toEqual([
      {
        ...about,
        action: "create",
        before: null,
        after: centro,
      },
      {
        ...about,
        action: "update",
        before: { name: "Sede Centro" },
        after: { name: "Sede Norte" },
      },
    ]);
  });

  it("records a room's creation, its edit and its deactivation", async () => {
    const { organization } = await setUpTestOrganization();
    const office = await theOffice(organization);
    const room = await newRoom(organization, office.id);
    await organization.updateRoom(adminCaller, { roomId: room.id, name: "Consultorio A" });
    await organization.setRoomActive(adminCaller, { id: room.id, active: false });

    const about = { entityType: "room", userId: adminCaller.userId, patientId: null };
    expect(await auditEntriesFor(organization, room.id)).toEqual([
      {
        ...about,
        action: "create",
        before: null,
        after: { officeId: office.id, name: "Consultorio 1" },
      },
      {
        ...about,
        action: "update",
        before: { name: "Consultorio 1" },
        after: { name: "Consultorio A" },
      },
      { ...about, action: "deactivate", before: { active: true }, after: { active: false } },
    ]);
  });
});
