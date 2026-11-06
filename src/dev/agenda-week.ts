import { and, eq } from "drizzle-orm";

import { instantOf } from "#/lib/time-ranges.ts";
import { shiftDate, weekdayOf } from "#/lib/schedules.ts";

import { bookAppointment, bookOverbooking } from "#/organization/appointments.ts";
import type { Database } from "#/organization/database.ts";
import { createMedicalService } from "#/organization/medical-services.ts";
import { insertMember } from "#/organization/members.ts";
import type { Acting } from "#/organization/members.ts";
import { createOffice, createRoom } from "#/organization/offices.ts";
import { registerPatient } from "#/organization/patients.ts";
import { createSchedule } from "#/organization/schedules.ts";
import {
  appointment,
  medicalService,
  office,
  patient,
  practitioner,
  room,
  schedule,
} from "#/organization/schema.ts";

// The busy week the agenda's CPU budget is measured on (#139), the shape of
// the Workers prototype's seed: one office, two rooms, four practitioners in
// two shifts per room, 20 patients, six 40-minute appointments per
// practitioner each weekday and a weekly overbooking, about 120 a week. Each
// call books one week, so a deployed seed stays one object call per request;
// the first call also adds the office, rooms, practitioners, patients and
// schedules. It goes through the same area functions a screen does, but for
// the practitioners' grid, which no screen sets yet.

const agendaWeekOffice = { name: "Sede Belgrano", address: "Av. Cabildo 2000" };

const rooms = [
  { name: "Consultorio 1", capacity: 1 },
  { name: "Consultorio 2", capacity: 2 },
] as const;

/** Practitioners 1 and 2 share room 1, 3 and 4 room 2: mornings and afternoons. */
const practitioners = [1, 2, 3, 4].map((n) => ({
  userId: `agenda-week-practitioner-${n}`,
  name: `Profesional ${n} Semana`,
  email: `profesional${n}@semana.example.com`,
  roomIndex: n <= 2 ? 0 : 1,
  shiftStart: n % 2 === 1 ? 8 * 60 : 13 * 60,
}));

const firstNames = [
  "Lucía",
  "Mateo",
  "Sofía",
  "Benjamín",
  "Valentina",
  "Thiago",
  "Emma",
  "Joaquín",
  "Martina",
  "Santiago",
];
const lastNames = ["Fernández", "López"];

const slotsPerShift = 6;
const slotMinutes = 40;
const serviceName = "Consulta semana";

export interface AgendaWeekInput {
  /** Any date of the week to book; the week runs Monday to Sunday. */
  date: string;
  /**
   * An existing practitioner member to stand in for practitioner 1, so a real
   * account (a Clerk user, deployed) sees the week as a practitioner.
   */
  practitionerUserId?: string;
}

/** `result` when the area accepted the step; a refusal stops the seed. */
function accepted<T extends { ok: boolean; reason?: string }>(
  step: string,
  result: T,
): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(`agenda week seed: ${step} refused (${result.reason ?? "unknown"})`);
  }
  return result as Extract<T, { ok: true }>;
}

function time(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function minutesOf(localTime: string): number {
  return Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(3, 5));
}

type Seeded = (typeof practitioners)[number];

/** Practitioner `one`, their 20-minute grid, medical service and weekday schedule in `roomId`. */
function addPractitioner(
  database: Database,
  acting: Acting,
  one: Seeded & { standIn: string | undefined; roomId: string; firstDate: string },
) {
  if (one.standIn === undefined) {
    accepted(
      "insertMember",
      database.transaction((tx) =>
        insertMember(tx, acting.userId, { ...one, roles: ["practitioner"] }),
      ),
    );
  }
  const { id: practitionerId } = database
    .select({ id: practitioner.id })
    .from(practitioner)
    .where(eq(practitioner.memberId, one.standIn ?? one.userId))
    .get()!;
  // No screen sets a practitioner's grid yet; 40-minute slots need a 20-minute one.
  database
    .update(practitioner)
    .set({ gridMinutes: slotMinutes / 2 })
    .where(eq(practitioner.id, practitionerId))
    .run();
  accepted(
    "createMedicalService",
    createMedicalService(database, acting, {
      practitionerId,
      name: serviceName,
      durationMinutes: slotMinutes,
    }),
  );
  accepted(
    "createSchedule",
    createSchedule(database, acting, {
      practitionerId,
      roomId: one.roomId,
      weekdays: [1, 2, 3, 4, 5],
      startTime: time(one.shiftStart),
      endTime: time(one.shiftStart + slotsPerShift * slotMinutes),
      firstDate: one.firstDate,
      lastDate: null,
    }),
  );
}

/** The office, rooms, practitioners, medical services, patients and schedules. */
function createWorld(database: Database, acting: Acting, input: AgendaWeekInput, monday: string) {
  const { office: created } = accepted(
    "createOffice",
    createOffice(database, acting, agendaWeekOffice),
  );
  const roomIds = rooms.map(
    (one) =>
      accepted("createRoom", createRoom(database, acting, { ...one, officeId: created.id })).room
        .id,
  );
  for (const [index, one] of practitioners.entries()) {
    addPractitioner(database, acting, {
      ...one,
      standIn: index === 0 ? input.practitionerUserId : undefined,
      roomId: roomIds[one.roomIndex]!,
      firstDate: monday,
    });
  }
  for (const [index, firstName] of [...firstNames, ...firstNames].entries()) {
    accepted(
      "registerPatient",
      registerPatient(database, acting, {
        firstName,
        lastName: lastNames[Math.floor(index / firstNames.length)]!,
        phone: `0351 15 500-${String(index + 1).padStart(4, "0")}`,
        confirmDuplicates: true,
      }),
    );
  }
  return { id: created.id, timeZone: created.timeZone };
}

/** The busy office, created on the first call. */
function ensureWorld(database: Database, acting: Acting, input: AgendaWeekInput, monday: string) {
  const found = database
    .select({ id: office.id, timeZone: office.timeZone })
    .from(office)
    .where(eq(office.name, agendaWeekOffice.name))
    .get();
  return found ?? createWorld(database, acting, input, monday);
}

/** The office's practitioners with their room, shift and medical service, in seed order, and the patients. */
function readWorld(database: Database, officeId: string) {
  const rows = database
    .selectDistinct({
      practitionerId: practitioner.id,
      roomId: room.id,
      roomName: room.name,
      startTime: schedule.startTime,
      medicalServiceId: medicalService.id,
    })
    .from(schedule)
    .innerJoin(room, and(eq(room.id, schedule.roomId), eq(room.officeId, officeId)))
    .innerJoin(practitioner, eq(practitioner.id, schedule.practitionerId))
    .innerJoin(
      medicalService,
      and(eq(medicalService.practitionerId, practitioner.id), eq(medicalService.name, serviceName)),
    )
    .all()
    .sort((a, b) => a.roomName.localeCompare(b.roomName) || a.startTime.localeCompare(b.startTime));
  const patientIds = database
    .select({ id: patient.id })
    .from(patient)
    .all()
    .map((one) => one.id);
  return { practitioners: rows, patientIds };
}

type World = ReturnType<typeof readWorld> & { timeZone: string };

/** Whether the practitioner has an overbooking from `start`: overbookings stack, so a re-run checks. */
function hasOverbooking(database: Database, practitionerId: string, start: Date) {
  const found = database
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      and(
        eq(appointment.practitionerId, practitionerId),
        eq(appointment.startsAt, +start),
        eq(appointment.overbooking, true),
      ),
    )
    .get();
  return found !== undefined;
}

/** Each practitioner's six slots on `date`; how many were booked. */
function bookDay(database: Database, acting: Acting, world: World, date: string) {
  let booked = 0;
  for (const [index, one] of world.practitioners.entries()) {
    for (let slot = 0; slot < slotsPerShift; slot++) {
      const result = bookAppointment(database, acting, {
        patientId: world.patientIds[(index * slotsPerShift + slot) % world.patientIds.length]!,
        practitionerId: one.practitionerId,
        medicalServiceId: one.medicalServiceId,
        start: instantOf(date, time(minutesOf(one.startTime) + slot * slotMinutes), world.timeZone),
        durationMinutes: slotMinutes,
        confirmWarnings: true,
      });
      booked += Number(result.ok);
    }
  }
  return booked;
}

/** Practitioner 1's overbooking over their 09:20 slot on `date`, unless it is there; how many were booked. */
function overbookDay(database: Database, acting: Acting, world: World, date: string) {
  const first = world.practitioners[0];
  const start = instantOf(date, "09:30", world.timeZone);
  if (!first || hasOverbooking(database, first.practitionerId, start)) {
    return 0;
  }
  const result = bookOverbooking(database, acting, {
    patientId: world.patientIds[7 % world.patientIds.length]!,
    practitionerId: first.practitionerId,
    medicalServiceId: first.medicalServiceId,
    start,
    durationMinutes: 20,
    roomId: first.roomId,
    confirmWarnings: true,
  });
  return Number(result.ok);
}

/**
 * Books the week of `input.date` in the busy office, as `acting` (an admin):
 * each practitioner's six slots on each weekday, and an overbooking over
 * practitioner 1's 09:20 slot on Wednesday. A slot already taken is skipped,
 * so a second run of a week adds nothing.
 */
export function seedAgendaWeek(database: Database, acting: Acting, input: AgendaWeekInput) {
  const monday = shiftDate(input.date, 1 - weekdayOf(input.date));
  const found = ensureWorld(database, acting, input, monday);
  const world = { ...readWorld(database, found.id), timeZone: found.timeZone };
  let booked = 0;
  for (let offset = 0; offset < 5; offset++) {
    booked += bookDay(database, acting, world, shiftDate(monday, offset));
  }
  booked += overbookDay(database, acting, world, shiftDate(monday, 2));
  return { ok: true as const, monday, booked };
}
