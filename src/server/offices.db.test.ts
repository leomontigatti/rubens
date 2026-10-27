import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import type { Actor } from "#/lib/access.ts";
import { createAuth } from "#/lib/auth.ts";
import { createOrganization } from "#/test-support/organization.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import {
  createOffice,
  createRoom,
  getOffice,
  listOffices,
  setOfficeActive,
  setRoomActive,
  updateOffice,
  updateRoom,
} from "./offices.ts";

// Every call runs as the app role, so row-level security applies as in the app.

let client: PGlite;
let db: TestDatabase;
let admin: Actor;
let receptionist: Actor;
let practitioner: Actor;

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  const { organizationId, adminUserId } = await createOrganization(createAuth(db));
  admin = { organizationId, userId: adminUserId, roles: ["admin"] };
  receptionist = { organizationId, userId: "receptionist", roles: ["receptionist"] };
  practitioner = { organizationId, userId: "practitioner", roles: ["practitioner"] };
});

afterEach(async () => {
  await client.close();
});

const centro = { name: "Sede Centro", address: "Av. Corrientes 1234" };

async function newOffice(input: Parameters<typeof createOffice>[1] = centro) {
  const result = await asAppRole(db, (tx) => createOffice(admin, input, tx));
  if (!result.ok) {
    throw new Error(`createOffice failed: ${result.reason}`);
  }
  return result.office;
}

async function newRoom(officeId: string, name = "Consultorio 1") {
  const result = await asAppRole(db, (tx) => createRoom(admin, { officeId, name }, tx));
  if (!result.ok) {
    throw new Error(`createRoom failed: ${result.reason}`);
  }
  return result.room;
}

describe("offices", () => {
  it("creates an office in the admin's organization, in Buenos Aires unless told otherwise", async () => {
    const created = await newOffice();
    const elsewhere = await newOffice({ ...centro, name: "Sede Sur", timeZone: "America/Cordoba" });

    expect(created).toMatchObject({
      ...centro,
      timeZone: "America/Argentina/Buenos_Aires",
      active: true,
    });
    expect(elsewhere.timeZone).toBe("America/Cordoba");
    const listed = await asAppRole(db, (tx) => listOffices(admin, { includeInactive: false }, tx));
    expect(listed.map((office) => office.name)).toEqual(["Sede Centro", "Sede Sur"]);
  });

  it("refuses a time zone that is not an IANA zone, and an empty name", async () => {
    for (const input of [
      { ...centro, timeZone: "Buenos Aires" },
      { ...centro, timeZone: "-03:00" },
      { ...centro, name: "  " },
    ]) {
      expect(await asAppRole(db, (tx) => createOffice(admin, input, tx))).toEqual({
        ok: false,
        reason: "invalidInput",
      });
    }
  });

  it("edits an office", async () => {
    const created = await newOffice();

    const result = await asAppRole(db, (tx) =>
      updateOffice(
        admin,
        { officeId: created.id, name: "Sede Norte", address: "Cabildo 1", timeZone: "UTC" },
        tx,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      office: { name: "Sede Norte", address: "Cabildo 1", timeZone: "UTC" },
    });
  });

  it("drops a deactivated office from the default list, shows it on request, and reactivates it", async () => {
    const created = await newOffice();

    await asAppRole(db, (tx) => setOfficeActive(admin, { id: created.id, active: false }, tx));
    const active = await asAppRole(db, (tx) => listOffices(admin, { includeInactive: false }, tx));
    const all = await asAppRole(db, (tx) => listOffices(admin, { includeInactive: true }, tx));
    await asAppRole(db, (tx) => setOfficeActive(admin, { id: created.id, active: true }, tx));
    const reactivated = await asAppRole(db, (tx) =>
      listOffices(admin, { includeInactive: false }, tx),
    );

    expect(active).toEqual([]);
    expect(all).toMatchObject([{ id: created.id, active: false }]);
    expect(reactivated).toMatchObject([{ id: created.id, active: true }]);
  });

  it("answers notFound for an office that does not exist", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";

    expect(
      await asAppRole(db, (tx) => updateOffice(admin, { ...centro, officeId: missing }, tx)),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(
      await asAppRole(db, (tx) => setOfficeActive(admin, { id: missing, active: false }, tx)),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("rooms", () => {
  it("creates a room in an office with a capacity of 1 unless told otherwise", async () => {
    const created = await newOffice();
    await newRoom(created.id);
    await asAppRole(db, (tx) =>
      createRoom(admin, { officeId: created.id, name: "Consultorio 2", capacity: 2 }, tx),
    );

    const result = await asAppRole(db, (tx) =>
      getOffice(admin, { officeId: created.id, includeInactive: false }, tx),
    );

    expect(result).toMatchObject({
      ok: true,
      office: { id: created.id },
      rooms: [
        { name: "Consultorio 1", capacity: 1, active: true },
        { name: "Consultorio 2", capacity: 2, active: true },
      ],
    });
  });

  it("refuses a capacity below 1", async () => {
    const created = await newOffice();

    expect(
      await asAppRole(db, (tx) =>
        createRoom(admin, { officeId: created.id, name: "Consultorio", capacity: 0 }, tx),
      ),
    ).toEqual({ ok: false, reason: "invalidInput" });
  });

  it("answers notFound for a room in an office that does not exist", async () => {
    expect(
      await asAppRole(db, (tx) =>
        createRoom(
          admin,
          { officeId: "00000000-0000-4000-8000-000000000000", name: "Consultorio" },
          tx,
        ),
      ),
    ).toEqual({ ok: false, reason: "notFound" });
  });

  it("edits a room", async () => {
    const created = await newOffice();
    const room = await newRoom(created.id);

    const result = await asAppRole(db, (tx) =>
      updateRoom(admin, { roomId: room.id, name: "Consultorio A", capacity: 3 }, tx),
    );

    expect(result).toMatchObject({ ok: true, room: { name: "Consultorio A", capacity: 3 } });
  });

  it("drops a deactivated room from the office's default list, shows it on request, and reactivates it", async () => {
    const created = await newOffice();
    const room = await newRoom(created.id);

    await asAppRole(db, (tx) => setRoomActive(admin, { id: room.id, active: false }, tx));
    const active = await asAppRole(db, (tx) =>
      getOffice(admin, { officeId: created.id, includeInactive: false }, tx),
    );
    const all = await asAppRole(db, (tx) =>
      getOffice(admin, { officeId: created.id, includeInactive: true }, tx),
    );
    await asAppRole(db, (tx) => setRoomActive(admin, { id: room.id, active: true }, tx));
    const reactivated = await asAppRole(db, (tx) =>
      getOffice(admin, { officeId: created.id, includeInactive: false }, tx),
    );

    expect(active).toMatchObject({ ok: true, rooms: [] });
    expect(all).toMatchObject({ ok: true, rooms: [{ id: room.id, active: false }] });
    expect(reactivated).toMatchObject({ ok: true, rooms: [{ id: room.id, active: true }] });
  });
});

describe("roles", () => {
  it("lets receptionists and practitioners see offices and rooms", async () => {
    const created = await newOffice();
    await newRoom(created.id);

    for (const actor of [receptionist, practitioner]) {
      const listed = await asAppRole(db, (tx) =>
        listOffices(actor, { includeInactive: false }, tx),
      );
      const detail = await asAppRole(db, (tx) =>
        getOffice(actor, { officeId: created.id, includeInactive: false }, tx),
      );
      expect(listed).toHaveLength(1);
      expect(detail).toMatchObject({ ok: true, rooms: [{ name: "Consultorio 1" }] });
    }
  });

  it("refuses every change to anyone without the admin role, and changes nothing", async () => {
    const created = await newOffice();
    const room = await newRoom(created.id);
    const nonAdmin: Actor = { ...receptionist, roles: ["receptionist", "practitioner"] };

    const results = await asAppRole(db, async (tx) => [
      await createOffice(nonAdmin, centro, tx),
      await updateOffice(nonAdmin, { ...centro, name: "X", officeId: created.id }, tx),
      await setOfficeActive(nonAdmin, { id: created.id, active: false }, tx),
      await createRoom(nonAdmin, { officeId: created.id, name: "X" }, tx),
      await updateRoom(nonAdmin, { roomId: room.id, name: "X", capacity: 1 }, tx),
      await setRoomActive(nonAdmin, { id: room.id, active: false }, tx),
    ]);

    for (const result of results) {
      expect(result).toEqual({ ok: false, reason: "forbidden" });
    }
    expect(
      await asAppRole(db, (tx) =>
        getOffice(admin, { officeId: created.id, includeInactive: true }, tx),
      ),
    ).toMatchObject({
      ok: true,
      office: { name: "Sede Centro", active: true },
      rooms: [{ name: "Consultorio 1", active: true }],
    });
  });
});
