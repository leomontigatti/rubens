import type { Actor, Role } from "#/lib/access.ts";
import { createAuth } from "#/lib/auth.ts";
import type { ScheduleInput } from "#/lib/schedules.ts";
import { createOrganization, startingPassword } from "#/test-support/organization.ts";

import { asAppRole } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { createAppointmentType } from "#/server/appointment-types.ts";
import { createOffice, createRoom } from "#/server/offices.ts";
import { registerPatient } from "#/server/patients.ts";
import { createSchedule, listSchedulePractitioners } from "#/server/schedules.ts";
import { createStaffMember } from "#/server/staff.ts";

/**
 * An organization with its admin, ready for scheduling: offices, rooms and
 * staff are added through the services, as the app role.
 */
export async function createSchedulingWorld(db: TestDatabase) {
  const auth = createAuth(db);
  const { organizationId, adminUserId } = await createOrganization(auth);
  const admin: Actor = { organizationId, userId: adminUserId, roles: ["admin"] };

  async function addOffice(name = "Sede Centro", timeZone = "America/Argentina/Buenos_Aires") {
    const result = await asAppRole(db, (tx) =>
      createOffice(admin, { name, address: "Calle 1", timeZone }, tx),
    );
    if (!result.ok) {
      throw new Error(`createOffice failed: ${result.reason}`);
    }
    return result.office;
  }

  async function addRoom(officeId: string, name = "Consultorio 1", capacity = 1) {
    const result = await asAppRole(db, (tx) => createRoom(admin, { officeId, name, capacity }, tx));
    if (!result.ok) {
      throw new Error(`createRoom failed: ${result.reason}`);
    }
    return result.room;
  }

  /** A staff member holding `roles`, and the actor they act as. */
  async function addStaff(name: string, roles: Role[] = ["practitioner"]) {
    const local = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replaceAll(" ", ".");
    const email = `${local}@example.com`;
    const result = await asAppRole(db, (tx) =>
      createStaffMember(admin, { name, email, password: startingPassword, roles }, tx),
    );
    if (!result.ok) {
      throw new Error(`createStaffMember failed: ${result.reason}`);
    }
    const actor: Actor = { organizationId, userId: result.member.userId, roles };
    return { member: result.member, actor };
  }

  return { auth, organizationId, admin, addOffice, addRoom, addStaff };
}

/**
 * A scheduling world ready for booking: an office in Buenos Aires (UTC-3) with
 * two rooms, two practitioners each with a type, a receptionist and patients,
 * all added through the services as the app role. 2099-01-05 is a Monday.
 */
export async function createBookingWorld(db: TestDatabase) {
  const world = await createSchedulingWorld(db);
  const office = await world.addOffice("Sede Centro");
  const room = await world.addRoom(office.id, "Consultorio 1");
  const otherRoom = await world.addRoom(office.id, "Consultorio 2");
  const juan = await world.addStaff("Juan Gómez");
  const lucia = await world.addStaff("Lucía Díaz");
  const receptionist = (await world.addStaff("Rita Paz", ["receptionist"])).actor;
  const listed = await asAppRole(db, (tx) => listSchedulePractitioners(world.admin, tx));
  const idOf = (name: string) => listed.find((row) => row.displayName === name)!.id;

  async function addType(practitionerId: string, durationMinutes = 30) {
    const result = await asAppRole(db, (tx) =>
      createAppointmentType(
        world.admin,
        { practitionerId, name: "Consulta", durationMinutes, color: "color1" },
        tx,
      ),
    );
    if (!result.ok) {
      throw new Error(`createAppointmentType failed: ${result.reason}`);
    }
    return result.appointmentType;
  }

  async function addSchedule(input: Partial<ScheduleInput> & { practitionerId: string }) {
    const result = await asAppRole(db, (tx) =>
      createSchedule(
        world.admin,
        {
          roomId: room.id,
          weekdays: [1],
          startTime: "09:00",
          endTime: "11:00",
          firstDate: "2099-01-05",
          lastDate: null,
          ...input,
        },
        tx,
      ),
    );
    if (!result.ok) {
      throw new Error(`createSchedule failed: ${result.reason}`);
    }
    return result.schedule;
  }

  async function addPatient(firstName: string, phone: string) {
    const result = await asAppRole(db, (tx) =>
      registerPatient(world.admin, { firstName, lastName: "Paz", phone }, tx),
    );
    if (!result.ok) {
      throw new Error(`registerPatient failed: ${result.reason}`);
    }
    return result.patient;
  }

  const practitioner = (staff: { actor: Actor }, name: string) => ({
    id: idOf(name),
    actor: staff.actor,
  });

  return {
    ...world,
    office,
    room,
    otherRoom,
    receptionist,
    juan: practitioner(juan, "Juan Gómez"),
    lucia: practitioner(lucia, "Lucía Díaz"),
    addType,
    addSchedule,
    addPatient,
  };
}

export type BookingWorld = Awaited<ReturnType<typeof createBookingWorld>>;
