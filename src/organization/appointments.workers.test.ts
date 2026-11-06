import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { BookingInput, OverbookingInput, WarningConfirmation } from "#/lib/appointments.ts";
import type { RangeEntry } from "#/lib/time-ranges.ts";

import {
  addOffice,
  addRoom,
  addStaff,
  adminCaller,
  at,
  auditEntriesFor,
  expectOk,
  inStorage,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import { appointment, member, office as officeTable } from "#/organization/schema.ts";

// The office is in Buenos Aires (UTC-3), so 09:00 there is 12:00Z. 2099-01-05
// is a Monday; Juan works there from 09:00 to 11:00 in "Consultorio 1",
// "Lucía" from 09:00 to 11:00 in "Consultorio 2".

type Caller = typeof adminCaller;

async function world() {
  const booking = await setUpBookingWorld();
  const { juan, lucia, otherRoom } = booking;
  await booking.addSchedule({ practitionerId: juan.practitionerId });
  await booking.addSchedule({ practitionerId: lucia.practitionerId, roomId: otherRoom.id });
  const juanService = await booking.addMedicalService(juan.practitionerId);
  const luciaService = await booking.addMedicalService(lucia.practitionerId);
  const maria = await booking.addPatient("María", "0351 15 555-1234");
  const pedro = await booking.addPatient("Pedro", "0351 15 555-9876");

  /** Juan's booking for `María` at 09:00 local, unless overridden. */
  const bookingOf = (overrides: Partial<BookingInput> = {}): BookingInput => ({
    patientId: maria.id,
    practitionerId: juan.practitionerId,
    medicalServiceId: juanService.id,
    start: at("12:00"),
    durationMinutes: 30,
    ...overrides,
  });

  /** Juan's overbooking for `Pedro` at 09:10 local, unless overridden. */
  const overbookingOf = (overrides: Partial<OverbookingInput> = {}): OverbookingInput => ({
    patientId: pedro.id,
    practitionerId: juan.practitionerId,
    medicalServiceId: juanService.id,
    start: at("12:10"),
    durationMinutes: 30,
    roomId: null,
    ...overrides,
  });

  const tryBook = (
    input: BookingInput & WarningConfirmation = bookingOf(),
    caller: Caller = booking.receptionist,
  ) => booking.organization.bookAppointment(caller, input);

  const tryOverbook = (
    input: OverbookingInput & WarningConfirmation = overbookingOf(),
    caller: Caller = booking.receptionist,
  ) => booking.organization.bookOverbooking(caller, input);

  async function freeStartsOf(practitionerId = juan.practitionerId, durationMinutes = 30) {
    const result = await booking.organization.getAvailability(adminCaller, {
      practitionerId,
      firstDate: "2099-01-05",
      lastDate: "2099-01-05",
      durationMinutes,
    });
    if (!result.ok) {
      throw new Error(`getAvailability refused: ${result.reason}`);
    }
    return result.freeStarts.map((free) => free.start.toISOString());
  }

  async function addTimeOff(entry: RangeEntry) {
    const result = await booking.organization.createTimeOff(adminCaller, {
      practitionerId: juan.practitionerId,
      entry,
    });
    if (!result.ok) {
      throw new Error(`createTimeOff refused: ${result.reason}`);
    }
  }

  /** Who booked it: kept in storage, shown by no method. */
  const createdByOf = (appointmentId: string) =>
    inStorage(
      booking.organization,
      (database) =>
        database
          .select({ createdBy: appointment.createdBy })
          .from(appointment)
          .where(eq(appointment.id, appointmentId))
          .get()?.createdBy,
    );

  const appointmentCount = () =>
    inStorage(booking.organization, (database) => database.select().from(appointment).all().length);

  return {
    ...booking,
    juanService,
    luciaService,
    maria,
    pedro,
    bookingOf,
    overbookingOf,
    tryBook,
    tryOverbook,
    freeStartsOf,
    addTimeOff,
    appointmentCount,
    createdByOf,
  };
}

describe("booking an appointment", () => {
  it("answers a taken start with the free starts its day has left, for that duration", async () => {
    const w = await world();
    await w.book(w.bookingOf());

    const refused = await w.tryBook(w.bookingOf({ patientId: w.pedro.id, durationMinutes: 60 }));

    expect(refused).toMatchObject({ ok: false, reason: "notFree" });
    const offered = !refused.ok && "freeStarts" in refused ? refused.freeStarts : [];
    expect(offered.map((free) => free.start.toISOString())).toEqual(
      await w.freeStartsOf(w.juan.practitionerId, 60),
    );
    expect(offered[0]).toEqual({
      start: at("12:30"),
      officeName: "Sede Centro",
      roomName: "Consultorio 1",
      timeZone: "America/Argentina/Buenos_Aires",
    });
  });

  it("offers the free starts of the refused start's day in its office's zone, not the default one", async () => {
    const w = await world();
    // Auckland is UTC+13 in January: its 14:00 to 18:00 on Tuesday the 6th
    // runs from 22:00 on Monday the 5th to 02:00 on the 6th in Buenos Aires.
    const auckland = await addOffice(w.organization, "Sede Auckland", "Pacific/Auckland");
    const room = await addRoom(w.organization, auckland.id, "Consultorio A");
    const pablo = await addStaff(w.organization, "Pablo Ruiz");
    await w.addSchedule({
      practitionerId: pablo.practitionerId,
      roomId: room.id,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      startTime: "14:00",
      endTime: "18:00",
    });
    const service = await w.addMedicalService(pablo.practitionerId);
    const pabloBooking = (patientId: string) => ({
      patientId,
      practitionerId: pablo.practitionerId,
      medicalServiceId: service.id,
      start: at("01:00", "2099-01-06"),
      durationMinutes: 30,
    });
    await w.book(pabloBooking(w.maria.id));

    const refused = await w.tryBook(pabloBooking(w.pedro.id));

    const offered = !refused.ok && "freeStarts" in refused ? refused.freeStarts : [];
    expect(offered.map((free) => free.start.toISOString())).toEqual(
      ["01:30", "02:00", "02:30", "03:00", "03:30", "04:00", "04:30"].map((time) =>
        at(time, "2099-01-06").toISOString(),
      ),
    );
  });

  it("books a free time in the room of the schedule it falls in, with the reception note", async () => {
    const w = await world();

    const created = await w.book({
      ...w.bookingOf({ durationMinutes: 45 }),
      receptionNote: "  Trae radiografías ",
    });

    expect(await w.appointmentOf(created.id)).toMatchObject({
      patientId: w.maria.id,
      practitionerId: w.juan.practitionerId,
      medicalServiceName: "Consulta",
      roomId: w.room.id,
      start: at("12:00"),
      end: at("12:45"),
      status: "booked",
      overbooking: false,
      receptionNote: "Trae radiografías",
    });
    expect(await w.createdByOf(created.id)).toBe(w.receptionist.userId);
  });

  it("refuses a start off the grid, outside the schedules or in time off", async () => {
    const w = await world();
    await w.addTimeOff({ kind: "hours", start: "2099-01-05T10:00", end: "2099-01-05T11:00" });

    for (const start of [at("12:10"), at("14:30"), at("13:00"), at("13:45")]) {
      expect(await w.tryBook(w.bookingOf({ start }))).toMatchObject({
        ok: false,
        reason: "notFree",
      });
    }
  });

  it("refuses a duration that runs past the schedule's end", async () => {
    const w = await world();

    expect(await w.tryBook(w.bookingOf({ start: at("13:30"), durationMinutes: 60 }))).toMatchObject(
      { ok: false, reason: "notFree" },
    );
    expect(await w.tryBook(w.bookingOf({ start: at("13:30") }))).toMatchObject({ ok: true });
  });

  it("takes a booked time out of the free times, and refuses an overlapping booking, saving nothing", async () => {
    const w = await world();
    await w.book(w.bookingOf());

    const free = await w.freeStartsOf();
    expect(free).not.toContain("2099-01-05T12:00:00.000Z");
    expect(free).toContain("2099-01-05T12:30:00.000Z");
    for (const start of [at("12:00"), at("12:15")]) {
      expect(await w.tryBook(w.bookingOf({ patientId: w.pedro.id, start }))).toMatchObject({
        ok: false,
        reason: "notFree",
      });
    }
    expect(await w.appointmentCount()).toBe(1);
  });

  it("frees the time again once the appointment no longer holds it", async () => {
    const w = await world();
    const { id } = await w.book(w.bookingOf());
    expectOk(
      await w.organization.cancelAppointment(w.receptionist, {
        appointmentId: id,
        cancelledBy: "patient",
        reason: "",
      }),
    );

    expect(await w.freeStartsOf()).toContain("2099-01-05T12:00:00.000Z");
    expect(await w.tryBook(w.bookingOf({ patientId: w.pedro.id }))).toMatchObject({ ok: true });
  });

  it("refuses another practitioner's medical service and a deactivated one", async () => {
    const w = await world();

    expect(await w.tryBook(w.bookingOf({ medicalServiceId: w.luciaService.id }))).toEqual({
      ok: false,
      reason: "notFound",
    });
    await w.organization.setMedicalServiceActive(adminCaller, {
      id: w.juanService.id,
      active: false,
    });
    expect(await w.tryBook()).toEqual({ ok: false, reason: "medicalServiceInactive" });
  });

  it("refuses a deactivated patient and an inactive practitioner", async () => {
    const w = await world();
    await w.organization.setPatientActive(adminCaller, { id: w.maria.id, active: false });

    expect(await w.tryBook()).toEqual({ ok: false, reason: "patientInactive" });

    const ana = await addStaff(w.organization, "Ana Ruiz");
    await inStorage(w.organization, (database) =>
      database
        .update(member)
        .set({ active: false })
        .where(eq(member.userId, ana.caller.userId))
        .run(),
    );
    expect(
      await w.tryBook(w.bookingOf({ patientId: w.pedro.id, practitionerId: ana.practitionerId })),
    ).toEqual({ ok: false, reason: "practitionerInactive" });
  });

  it("refuses input that is not a booking", async () => {
    const w = await world();

    expect(await w.tryBook(w.bookingOf({ durationMinutes: 0 }))).toEqual({
      ok: false,
      reason: "invalidInput",
    });
  });

  it("writes the booking to the audit log, about the patient", async () => {
    const w = await world();
    const created = await w.book(w.bookingOf());

    expect(await auditEntriesFor(w.organization, created.id)).toEqual([
      {
        action: "create",
        entityType: "appointment",
        userId: w.receptionist.userId,
        patientId: w.maria.id,
        before: null,
        after: {
          patientId: w.maria.id,
          practitionerId: w.juan.practitionerId,
          medicalServiceId: w.juanService.id,
          roomId: w.room.id,
          receptionNote: null,
          start: "2099-01-05T12:00:00.000Z",
          end: "2099-01-05T12:30:00.000Z",
          status: "booked",
        },
      },
    ]);
  });
});

describe("the patient warning", () => {
  it("warns when the patient has an overlapping appointment, and books once confirmed", async () => {
    const w = await world();
    await w.book(
      w.bookingOf({ practitionerId: w.lucia.practitionerId, medicalServiceId: w.luciaService.id }),
    );

    expect(await w.tryBook()).toEqual({
      ok: false,
      reason: "patientWarning",
      warnings: [
        {
          kind: "overlap",
          start: at("12:00"),
          end: at("12:30"),
          practitionerName: "Lucía Díaz",
          timeZone: "America/Argentina/Buenos_Aires",
        },
      ],
    });
    expect(await w.tryBook({ ...w.bookingOf(), confirmWarnings: true })).toMatchObject({
      ok: true,
    });
  });

  it("warns of another appointment the same day, and not of one another day", async () => {
    const w = await world();
    await w.book(
      w.bookingOf({
        practitionerId: w.lucia.practitionerId,
        medicalServiceId: w.luciaService.id,
        start: at("13:00"),
      }),
    );

    expect(await w.tryBook()).toMatchObject({
      ok: false,
      reason: "patientWarning",
      warnings: [{ kind: "sameDay", start: at("13:00"), practitionerName: "Lucía Díaz" }],
    });

    await w.addSchedule({
      practitionerId: w.juan.practitionerId,
      weekdays: [2],
      firstDate: "2099-01-06",
    });
    await w.book(w.bookingOf({ patientId: w.pedro.id }));
    expect(
      await w.tryBook(w.bookingOf({ patientId: w.pedro.id, start: at("12:00", "2099-01-06") })),
    ).toMatchObject({ ok: true });
  });
});

describe("who books", () => {
  it("lets reception and admins book for anyone, and a practitioner only for themselves", async () => {
    const w = await world();

    expect(await w.tryBook(w.bookingOf(), adminCaller)).toMatchObject({ ok: true });
    expect(
      await w.tryBook(
        {
          ...w.bookingOf({
            practitionerId: w.lucia.practitionerId,
            medicalServiceId: w.luciaService.id,
          }),
          confirmWarnings: true,
        },
        w.lucia.caller,
      ),
    ).toMatchObject({ ok: true });
    expect(await w.tryBook(w.bookingOf({ start: at("12:30") }), w.lucia.caller)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("refuses a caller who is not a member, saving nothing", async () => {
    const w = await world();

    expect(await w.tryBook(w.bookingOf(), { userId: "user-stranger" })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(await w.tryOverbook(w.overbookingOf(), { userId: "user-stranger" })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(await w.appointmentCount()).toBe(0);
  });
});

describe("a room two practitioners share", () => {
  // Both work there from 11:00 to 13:00 too, 14:00Z to 16:00Z.
  async function sharedWorld() {
    const w = await world();
    const shared = await addRoom(w.organization, w.office.id, "Consultorio doble", 2);
    for (const practitionerId of [w.juan.practitionerId, w.lucia.practitionerId]) {
      await w.addSchedule({
        practitionerId,
        roomId: shared.id,
        startTime: "11:00",
        endTime: "13:00",
      });
    }
    await w.book(w.bookingOf({ start: at("14:00") }));
    return w;
  }

  it("offers no other practitioner the time an appointment there holds, and refuses booking it", async () => {
    const w = await sharedWorld();

    const offered = await w.freeStartsOf(w.lucia.practitionerId);

    expect(offered).toContain("2099-01-05T14:30:00.000Z");
    expect(offered).not.toContain("2099-01-05T14:00:00.000Z");
    expect(
      await w.tryBook(
        w.bookingOf({
          patientId: w.pedro.id,
          practitionerId: w.lucia.practitionerId,
          medicalServiceId: w.luciaService.id,
          start: at("14:00"),
        }),
      ),
    ).toMatchObject({ ok: false, reason: "notFree" });
    expect(await w.appointmentCount()).toBe(1);
  });
});

describe("an overbooking on top of another appointment", () => {
  it("books over the appointment, off the grid, in the room of the schedule", async () => {
    const w = await world();
    await w.book(w.bookingOf());

    const created = await w.overbook(w.overbookingOf());

    expect(await w.appointmentOf(created.id)).toMatchObject({
      patientId: w.pedro.id,
      practitionerId: w.juan.practitionerId,
      roomId: w.room.id,
      start: at("12:10"),
      end: at("12:40"),
      status: "booked",
      overbooking: true,
    });
    expect(await w.createdByOf(created.id)).toBe(w.receptionist.userId);
  });

  it("is a busy range, never offered as a free time", async () => {
    const w = await world();
    await w.overbook(w.overbookingOf({ start: at("13:00") }));

    expect(await w.freeStartsOf(w.juan.practitionerId, 15)).toEqual(
      ["12:00", "12:30", "13:30"].map((time) => at(time).toISOString()),
    );
  });

  it("is refused in the practitioner's time off and in a closure, saving nothing", async () => {
    const w = await world();
    await w.addTimeOff({ kind: "hours", start: "2099-01-05T09:00", end: "2099-01-05T09:30" });

    expect(await w.tryOverbook()).toEqual({ ok: false, reason: "timeOff" });

    await w.organization.createClosure(adminCaller, {
      officeId: w.office.id,
      entry: { kind: "hours", start: "2099-01-05T10:00", end: "2099-01-05T10:30" },
    });
    expect(await w.tryOverbook(w.overbookingOf({ start: at("13:00") }))).toEqual({
      ok: false,
      reason: "closed",
    });
    expect(await w.appointmentCount()).toBe(0);
  });

  it("warns of the patient's other appointment that day, like a booking", async () => {
    const w = await world();
    await w.book(w.bookingOf());

    expect(await w.tryOverbook(w.overbookingOf({ patientId: w.maria.id }))).toMatchObject({
      ok: false,
      reason: "patientWarning",
      warnings: [{ kind: "overlap" }],
    });
    expect(
      await w.tryOverbook({ ...w.overbookingOf({ patientId: w.maria.id }), confirmWarnings: true }),
    ).toMatchObject({ ok: true });
  });
});

describe("an overbooking outside the practitioner's schedules", () => {
  // "Consultorio 3" is empty, of capacity 1, and "Consultorio 4" of capacity 2.
  async function roomsWorld() {
    const w = await world();
    const third = await addRoom(w.organization, w.office.id, "Consultorio 3");
    const double = await addRoom(w.organization, w.office.id, "Consultorio 4", 2);
    return { ...w, third, double };
  }

  it("needs a room picked", async () => {
    const w = await roomsWorld();

    expect(await w.tryOverbook(w.overbookingOf({ start: at("15:00") }))).toEqual({
      ok: false,
      reason: "roomRequired",
    });
  });

  it("books in a room with space", async () => {
    const w = await roomsWorld();

    const created = await w.overbook(w.overbookingOf({ start: at("15:00"), roomId: w.third.id }));

    expect(await w.appointmentOf(created.id)).toMatchObject({
      roomId: w.third.id,
      overbooking: true,
    });
  });

  it("is refused in a room another practitioner's schedule fills, naming them", async () => {
    const w = await roomsWorld();

    expect(
      await w.tryOverbook(w.overbookingOf({ start: at("12:30"), roomId: w.otherRoom.id })),
    ).toEqual({
      ok: false,
      reason: "roomFull",
      occupants: [
        { practitionerName: "Lucía Díaz", kind: "schedule", start: at("12:00"), end: at("14:00") },
      ],
    });
  });

  it("is refused in a room another practitioner's appointment fills, saving nothing", async () => {
    const w = await roomsWorld();
    await w.overbook(
      w.overbookingOf({
        practitionerId: w.lucia.practitionerId,
        medicalServiceId: w.luciaService.id,
        patientId: w.maria.id,
        start: at("15:00"),
        roomId: w.third.id,
      }),
    );

    expect(
      await w.tryOverbook(w.overbookingOf({ start: at("15:15"), roomId: w.third.id })),
    ).toEqual({
      ok: false,
      reason: "roomFull",
      occupants: [
        {
          practitionerName: "Lucía Díaz",
          kind: "appointment",
          start: at("15:00"),
          end: at("15:30"),
        },
      ],
    });
    expect(await w.appointmentCount()).toBe(1);
  });

  it("fits beside one other practitioner in a room of capacity 2, and not beside two", async () => {
    const w = await roomsWorld();
    // The second schedule of "Lucía" follows the one in "Consultorio 2".
    await w.addSchedule({
      practitionerId: w.lucia.practitionerId,
      roomId: w.double.id,
      startTime: "11:00",
      endTime: "13:00",
    });
    const inDouble = w.overbookingOf({ start: at("14:30"), roomId: w.double.id });

    expect(await w.tryOverbook(inDouble)).toMatchObject({ ok: true });

    const ana = await addStaff(w.organization, "Ana Ruiz");
    await w.addSchedule({
      practitionerId: ana.practitionerId,
      roomId: w.double.id,
      startTime: "11:00",
      endTime: "11:30",
    });

    expect(
      await w.tryOverbook({ ...inDouble, patientId: w.maria.id, start: at("14:00") }),
    ).toMatchObject({
      ok: false,
      reason: "roomFull",
      occupants: [{ practitionerName: "Ana Ruiz" }, { practitionerName: "Lucía Díaz" }],
    });
  });

  it("is refused over another practitioner's appointment in a room they share, naming it", async () => {
    const w = await roomsWorld();
    // "Lucía" works in "Consultorio 4" too, where Juan's overbooking is.
    await w.addSchedule({
      practitionerId: w.lucia.practitionerId,
      roomId: w.double.id,
      startTime: "11:00",
      endTime: "13:00",
    });
    await w.overbook(w.overbookingOf({ start: at("14:30"), roomId: w.double.id }));

    expect(
      await w.tryOverbook(
        w.overbookingOf({
          patientId: w.maria.id,
          practitionerId: w.lucia.practitionerId,
          medicalServiceId: w.luciaService.id,
          start: at("14:30"),
          roomId: w.double.id,
        }),
      ),
    ).toMatchObject({
      ok: false,
      reason: "roomFull",
      occupants: [{ practitionerName: "Juan Gómez", kind: "appointment" }],
    });
  });

  it("adds no practitioner on top of their own appointment in that room", async () => {
    const w = await roomsWorld();
    await w.overbook(w.overbookingOf({ start: at("15:00"), roomId: w.third.id }));

    expect(
      await w.tryOverbook(
        w.overbookingOf({ patientId: w.maria.id, start: at("15:00"), roomId: w.third.id }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("is refused in a deactivated room", async () => {
    const w = await roomsWorld();
    await w.organization.setRoomActive(adminCaller, { id: w.third.id, active: false });

    expect(
      await w.tryOverbook(w.overbookingOf({ start: at("15:00"), roomId: w.third.id })),
    ).toEqual({ ok: false, reason: "roomInactive" });
  });
});

describe("who books overbookings", () => {
  it("lets a practitioner book only their own", async () => {
    const w = await world();

    expect(await w.tryOverbook(w.overbookingOf(), w.juan.caller)).toMatchObject({ ok: true });
    expect(
      await w.tryOverbook(
        w.overbookingOf({ patientId: w.maria.id, start: at("13:00") }),
        w.lucia.caller,
      ),
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("writes the overbooking to the audit log, about its patient, with its flag", async () => {
    const w = await world();
    const created = await w.overbook(w.overbookingOf({ start: at("12:00") }));

    expect(await auditEntriesFor(w.organization, created.id)).toEqual([
      expect.objectContaining({
        action: "create",
        patientId: w.pedro.id,
        after: {
          patientId: w.pedro.id,
          practitionerId: w.juan.practitionerId,
          medicalServiceId: w.juanService.id,
          roomId: w.room.id,
          overbooking: true,
          receptionNote: null,
          start: "2099-01-05T12:00:00.000Z",
          end: "2099-01-05T12:30:00.000Z",
          status: "booked",
        },
      }),
    ]);
  });
});

describe("a patient's appointments", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function patientWorld() {
    const w = await world();
    const bookFor = async (who: "juan" | "lucia", start: Date) => {
      const service = who === "juan" ? w.juanService : w.luciaService;
      const created = await w.book({
        ...w.bookingOf({
          practitionerId: w[who].practitionerId,
          medicalServiceId: service.id,
          start,
        }),
        confirmWarnings: true,
      });
      return created.id;
    };
    async function listOf(caller: Caller, patientId = w.maria.id) {
      const result = await w.organization.getPatientAppointments(caller, { patientId });
      if (!result.ok) {
        throw new Error(`getPatientAppointments refused: ${result.reason}`);
      }
      return result;
    }
    return { ...w, bookFor, listOf };
  }

  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

  it("splits past from upcoming, cancellations included, nearest first", async () => {
    const w = await patientWorld();
    const first = await w.bookFor("juan", at("12:00"));
    const second = await w.bookFor("lucia", at("13:00"));
    const later = await w.bookFor("juan", at("12:00", "2099-01-12"));
    await inStorage(w.organization, (database) =>
      database
        .update(appointment)
        .set({ status: "cancelled", cancelledBy: "patient" })
        .where(eq(appointment.id, second))
        .run(),
    );
    vi.setSystemTime(new Date("2099-01-05T13:30:00Z"));

    const listed = await w.listOf(w.receptionist);

    expect({ upcoming: ids(listed.upcoming), past: ids(listed.past) }).toEqual({
      upcoming: [later],
      past: [second, first],
    });
    expect(listed.past[0]).toMatchObject({
      start: at("13:00"),
      end: at("13:30"),
      status: "cancelled",
      cancelledBy: "patient",
      practitionerName: "Lucía Díaz",
      medicalServiceName: "Consulta",
      officeName: "Sede Centro",
      roomName: "Consultorio 2",
      timeZone: "America/Argentina/Buenos_Aires",
    });
  });

  it("shows a practitioner only the appointments with themselves", async () => {
    const w = await patientWorld();
    const withJuan = await w.bookFor("juan", at("12:00"));
    await w.bookFor("lucia", at("13:00"));

    const listed = await w.listOf(w.juan.caller);

    expect({ upcoming: ids(listed.upcoming), past: ids(listed.past) }).toEqual({
      upcoming: [withJuan],
      past: [],
    });
  });

  it("answers notFound for an unknown patient", async () => {
    const w = await patientWorld();

    expect(
      await w.organization.getPatientAppointments(w.receptionist, {
        patientId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "notFound" });
    expect(
      await w.organization.getPatientAppointments(w.receptionist, { patientId: "nope" }),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("an appointment in the patient's change history", () => {
  it("comes with its office's zone and the names of its practitioner, medical service and room", async () => {
    const w = await world();
    await w.book(w.bookingOf());
    // Another office's zone shows the history reads the appointment's own office.
    const north = await addOffice(w.organization, "Sede Norte");
    await inStorage(w.organization, (database) =>
      database
        .update(officeTable)
        .set({ timeZone: "America/Lima" })
        .where(eq(officeTable.id, north.id))
        .run(),
    );

    const result = await w.organization.getPatientHistory(adminCaller, { patientId: w.maria.id });
    if (!result.ok) {
      throw new Error(`getPatientHistory refused: ${result.reason}`);
    }

    expect(result.entries.find((entry) => entry.entityType === "appointment")).toMatchObject({
      action: "create",
      timeZones: {
        before: "America/Argentina/Buenos_Aires",
        after: "America/Argentina/Buenos_Aires",
      },
      after: { start: "2099-01-05T12:00:00.000Z" },
    });
    expect(result.names).toEqual({
      [w.juan.practitionerId]: "Juan Gómez",
      [w.juanService.id]: "Consulta",
      [w.room.id]: "Consultorio 1",
    });
  });
});
