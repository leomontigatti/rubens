import type { Actor } from "#/lib/access.ts";
import type { ScheduleInput } from "#/lib/schedules.ts";
import { createSchedulingWorld } from "#/test-support/scheduling.ts";

import { asAppRole } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { createAppointmentType } from "#/server/appointment-types.ts";
import { registerPatient } from "#/server/patients.ts";
import { createSchedule, listSchedulePractitioners } from "#/server/schedules.ts";

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
