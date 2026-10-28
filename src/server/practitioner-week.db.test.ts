import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { appointment } from "#/db/schema/index.ts";

import { asAppRole, createTestDatabase } from "../../tests/db/harness.ts";
import type { TestDatabase } from "../../tests/db/harness.ts";
import { cancelAppointment } from "#/server/appointment-statuses.ts";
import { createBookingWorld } from "#/test-support/scheduling.ts";
import type { BookingWorld } from "#/test-support/scheduling.ts";
import { bookAppointment } from "#/server/appointments.ts";
import { getPractitionerWeek } from "#/server/practitioner-week.ts";

// Every service call runs as the app role. The offices are in Buenos Aires
// (UTC-3), so 09:00 there is 12:00Z. 2099-01-05 is a Monday; Juan works from
// 09:00 to 11:00 on Mondays at "Sede Centro", and on Wednesdays at "Sede Norte".

let client: PGlite;
let db: TestDatabase;
let world: BookingWorld;
let juanType: { id: string };
let maria: { id: string };
let north: { id: string };

function at(time: string, date = "2099-01-05") {
  return new Date(`${date}T${time}:00Z`);
}

beforeEach(async () => {
  ({ client, db } = await createTestDatabase());
  world = await createBookingWorld(db);
  north = await world.addOffice("Sede Norte");
  const northRoom = await world.addRoom(north.id, "Norte 1");
  await world.addSchedule({ practitionerId: world.juan.id });
  await world.addSchedule({ practitionerId: world.juan.id, roomId: northRoom.id, weekdays: [3] });
  juanType = await world.addType(world.juan.id, 60);
  maria = await world.addPatient("María", "0351 15 555-1234");
});

afterEach(async () => {
  await client.close();
});

async function book(start: Date) {
  const result = await asAppRole(db, (tx) =>
    bookAppointment(
      world.receptionist,
      {
        patientId: maria.id,
        practitionerId: world.juan.id,
        medicalServiceId: juanType.id,
        start,
        durationMinutes: 60,
        confirmWarnings: true,
      },
      tx,
    ),
  );
  if (!result.ok) {
    throw new Error(`bookAppointment failed: ${result.reason}`);
  }
  return result.appointment.id;
}

function week(actor = world.receptionist, includeCancelledAndNoShow = false) {
  return asAppRole(db, (tx) =>
    getPractitionerWeek(
      actor,
      { practitionerId: world.juan.id, date: "2099-01-05", includeCancelledAndNoShow },
      tx,
    ),
  );
}

describe("a practitioner's week", () => {
  it("shows seven days from the date, each with its schedules, appointments and free times, across offices", async () => {
    const id = await book(at("12:00"));

    const result = await week();
    if (!result.ok) {
      throw new Error(result.reason);
    }

    expect(result.days.map((day) => day.date)).toEqual([
      "2099-01-05",
      "2099-01-06",
      "2099-01-07",
      "2099-01-08",
      "2099-01-09",
      "2099-01-10",
      "2099-01-11",
    ]);
    const [monday, , wednesday] = result.days;
    expect(monday!.schedules).toEqual([
      { start: at("12:00"), end: at("14:00"), roomName: "Consultorio 1" },
    ]);
    expect(monday!.appointments.map((booked) => [booked.id, booked.officeId])).toEqual([
      [id, world.office.id],
    ]);
    expect(monday!.freeStarts.map((free) => free.start)).toEqual([at("13:00"), at("13:30")]);
    expect(wednesday!.schedules).toEqual([
      { start: at("12:00", "2099-01-07"), end: at("14:00", "2099-01-07"), roomName: "Norte 1" },
    ]);
    expect(result.offices.map((office) => office.name)).toEqual(["Sede Centro", "Sede Norte"]);
  });

  it("hides cancelled and no-show appointments unless asked for", async () => {
    const id = await book(at("12:00"));
    await asAppRole(db, (tx) =>
      cancelAppointment(
        world.receptionist,
        { appointmentId: id, cancelledBy: "patient", reason: null },
        tx,
      ),
    );

    const absentId = await book(at("13:00"));
    await db.update(appointment).set({ status: "noShow" }).where(eq(appointment.id, absentId));

    const hidden = await week();
    const shown = await week(world.receptionist, true);

    expect(hidden.ok && hidden.days[0]!.appointments).toEqual([]);
    expect(shown.ok && shown.days[0]!.appointments.map((booked) => booked.status)).toEqual([
      "cancelled",
      "noShow",
    ]);
  });

  it("is open to the practitioner themselves, and to no other practitioner", async () => {
    await book(at("12:00"));

    const own = await week(world.juan.actor);
    const other = await week(world.lucia.actor);

    expect(own.ok && own.days[0]!.appointments).toHaveLength(1);
    expect(other).toEqual({ ok: false, reason: "forbidden" });
  });
});
