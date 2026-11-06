import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import type { AppointmentStatus, BookingInput, CalendarWeekQuery } from "#/lib/appointments.ts";

import {
  addRoom,
  addStaff,
  adminCaller,
  inStorage,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import { appointment, medicalService, practitioner, timeOff } from "#/organization/schema.ts";

// The office is in Buenos Aires (UTC-3), so 09:00 there is 12:00Z. 2099-01-05
// is a Monday. Juan and "Lucía" both work Mondays 09:00 to 11:00 in
// "Consultorio doble", a room for two.

type Caller = typeof adminCaller;

function at(time: string, date = "2099-01-05") {
  return new Date(`${date}T${time}:00Z`);
}

async function world() {
  const booking = await setUpBookingWorld();
  const { organization, juan, lucia } = booking;
  const shared = await addRoom(organization, booking.office.id, "Consultorio doble", 2);
  await booking.addSchedule({ practitionerId: juan.practitionerId, roomId: shared.id });
  await booking.addSchedule({ practitionerId: lucia.practitionerId, roomId: shared.id });
  const juanService = await booking.addMedicalService(juan.practitionerId);
  const juanLongService = await booking.addMedicalService(juan.practitionerId, 60);
  const luciaService = await booking.addMedicalService(lucia.practitionerId);
  const maria = await booking.addPatient("María", "0351 15 555-1234");
  let phones = 0;
  /** A patient of their own, so no patient warning stands in the way. */
  const anotherPatient = () =>
    booking.addPatient(`Paciente ${++phones}`, `0351 15 555-${String(phones).padStart(4, "0")}`);

  const book = (overrides: Partial<BookingInput> = {}) =>
    booking.book({
      patientId: maria.id,
      practitionerId: juan.practitionerId,
      medicalServiceId: juanService.id,
      start: at("12:00"),
      durationMinutes: 30,
      receptionNote: "Trae estudios",
      ...overrides,
    });

  const overbook = (overrides: Partial<BookingInput> & { roomId?: string } = {}) =>
    booking.overbook({
      patientId: maria.id,
      practitionerId: juan.practitionerId,
      medicalServiceId: juanService.id,
      start: at("12:00"),
      durationMinutes: 30,
      roomId: shared.id,
      confirmWarnings: true,
      ...overrides,
    });

  async function weekOf(caller: Caller, query: Partial<CalendarWeekQuery> = {}) {
    const result = await organization.getCalendarWeek(caller, {
      roomId: shared.id,
      date: "2099-01-07",
      ...query,
    });
    if (!result.ok || !result.week) {
      throw new Error(`getCalendarWeek refused: ${result.ok ? "no week" : result.reason}`);
    }
    return result.week;
  }

  /** Each free start of Monday as "HH:MM practitioner", in UTC. */
  function mondayFree(week: Awaited<ReturnType<typeof weekOf>>) {
    const names = new Map(week.practitioners.map((one) => [one.id, one.displayName]));
    return week.days[0]!.freeStarts.map(
      (free) => `${free.start.toISOString().slice(11, 16)} ${names.get(free.practitionerId)}`,
    );
  }

  /** Sets the appointment's status in storage: status changes port with #138. */
  function setStatus(appointmentId: string, status: AppointmentStatus) {
    return inStorage(organization, (database) =>
      database
        .update(appointment)
        .set({
          status,
          cancelledBy: status === "cancelled" ? "patient" : null,
          previousStatus: "booked",
        })
        .where(eq(appointment.id, appointmentId))
        .run(),
    );
  }

  return {
    ...booking,
    shared,
    juanService,
    juanLongService,
    luciaService,
    maria,
    anotherPatient,
    book,
    overbook,
    weekOf,
    mondayFree,
    setStatus,
  };
}

describe("where a practitioner's calendar opens", () => {
  const tuesday = "2099-01-06";

  async function opening(
    w: Awaited<ReturnType<typeof world>>,
    caller: Caller,
    query: Partial<CalendarWeekQuery> = {},
  ) {
    const result = await w.organization.getCalendarWeek(caller, { date: "2099-01-07", ...query });
    if (!result.ok || !result.week) {
      throw new Error(`getCalendarWeek refused: ${result.ok ? "no week" : result.reason}`);
    }
    return { roomId: result.week.room.id, practitionerId: result.week.filter.practitionerId };
  }

  /** Two of Juan's appointments on Tuesday in the other room, against one on Monday. */
  async function bookMostlyInOtherRoom(w: Awaited<ReturnType<typeof world>>) {
    await w.addSchedule({
      practitionerId: w.juan.practitionerId,
      roomId: w.otherRoom.id,
      weekdays: [2],
    });
    await w.book();
    const first = await w.book({
      start: at("12:00", tuesday),
      patientId: (await w.anotherPatient()).id,
    });
    await w.book({ start: at("12:30", tuesday), patientId: (await w.anotherPatient()).id });
    return first;
  }

  it("is the room with most of their appointments that week, filtered to themselves", async () => {
    const w = await world();
    await bookMostlyInOtherRoom(w);

    expect(await opening(w, w.juan.caller)).toEqual({
      roomId: w.otherRoom.id,
      practitionerId: w.juan.practitionerId,
    });
  });

  it("counts only that week's active appointments", async () => {
    const w = await world();
    const first = await bookMostlyInOtherRoom(w);
    await w.setStatus(first.id, "cancelled");
    await w.book({ start: at("12:30"), patientId: (await w.anotherPatient()).id });
    await w.book({ start: at("12:00", "2099-01-12") });

    expect((await opening(w, w.juan.caller)).roomId).toBe(w.shared.id);
    expect((await opening(w, w.juan.caller, { date: "2099-01-14" })).roomId).toBe(w.shared.id);
  });

  it("is a room they are scheduled in when they have no appointments", async () => {
    const w = await world();

    expect(await opening(w, w.juan.caller)).toEqual({
      roomId: w.shared.id,
      practitionerId: w.juan.practitionerId,
    });
  });

  it("skips a schedule with no day that week", async () => {
    const w = await world();
    await w.addSchedule({
      practitionerId: w.juan.practitionerId,
      weekdays: [2],
      firstDate: "2099-01-07",
    });

    expect((await opening(w, w.juan.caller)).roomId).toBe(w.shared.id);
  });

  it("skips a deactivated room", async () => {
    const w = await world();
    await bookMostlyInOtherRoom(w);

    expect(
      await w.organization.setRoomActive(adminCaller, { id: w.otherRoom.id, active: false }),
    ).toMatchObject({ ok: true });
    expect((await opening(w, w.juan.caller)).roomId).toBe(w.shared.id);
  });

  it("is the first room, unfiltered, for a practitioner with nothing anywhere", async () => {
    const w = await world();
    const ana = await addStaff(w.organization, "Ana Ruiz");

    expect(await opening(w, ana.caller)).toEqual({ roomId: w.room.id, practitionerId: null });
  });

  it("leaves a room the URL names unfiltered, for the practitioner to see everyone", async () => {
    const w = await world();

    expect(await opening(w, w.juan.caller, { roomId: w.shared.id })).toEqual({
      roomId: w.shared.id,
      practitionerId: null,
    });
  });

  it("keeps a medical service the URL names", async () => {
    const w = await world();

    expect(await opening(w, w.juan.caller, { medicalServiceId: w.luciaService.id })).toEqual({
      roomId: w.shared.id,
      practitionerId: w.lucia.practitionerId,
    });
  });

  it("stays the first room, unfiltered, for reception", async () => {
    const w = await world();
    await bookMostlyInOtherRoom(w);

    expect(await opening(w, w.receptionist)).toEqual({ roomId: w.room.id, practitionerId: null });
  });
});

describe("the calendar week of a room", () => {
  it("shows Monday to Sunday around the date, with the room's practitioners in their colours", async () => {
    const w = await world();

    const week = await w.weekOf(w.receptionist);

    expect(week.room).toEqual({ id: w.shared.id, name: "Consultorio doble" });
    expect(week.office).toMatchObject({
      id: w.office.id,
      timeZone: "America/Argentina/Buenos_Aires",
    });
    expect(week.days.map((day) => day.date)).toEqual([
      "2099-01-05",
      "2099-01-06",
      "2099-01-07",
      "2099-01-08",
      "2099-01-09",
      "2099-01-10",
      "2099-01-11",
    ]);
    expect(week.practitioners).toEqual([
      {
        id: w.juan.practitionerId,
        displayName: "Juan Gómez",
        color: expect.stringMatching(/^color/),
      },
      {
        id: w.lucia.practitionerId,
        displayName: "Lucía Díaz",
        color: expect.stringMatching(/^color/),
      },
    ]);
    expect(week.medicalServices.map((service) => service.id).sort()).toEqual(
      [w.juanService.id, w.juanLongService.id, w.luciaService.id].sort(),
    );
  });

  it("frees a cell for every practitioner who is free for all of it, and draws the appointments", async () => {
    const w = await world();
    const { id } = await w.book();

    const week = await w.weekOf(w.receptionist);

    // Juan's appointment holds the shared room at 12:00, for "Lucía" too.
    expect(w.mondayFree(week)).toEqual([
      "12:30 Juan Gómez",
      "12:30 Lucía Díaz",
      "13:00 Juan Gómez",
      "13:00 Lucía Díaz",
      "13:30 Juan Gómez",
      "13:30 Lucía Díaz",
    ]);
    expect(week.days[0]!.cards).toEqual([
      expect.objectContaining({
        kind: "appointment",
        id,
        practitionerId: w.juan.practitionerId,
        practitionerName: "Juan Gómez",
        patientName: "María Paz",
        medicalServiceName: "Consulta",
        receptionNote: "Trae estudios",
        status: "booked",
        start: at("12:00"),
        end: at("12:30"),
        roomName: "Consultorio doble",
      }),
    ]);
    expect(week.days.slice(1).every((day) => day.freeStarts.length === 0)).toBe(true);
  });

  it("narrows to the practitioner asked for", async () => {
    const w = await world();
    await w.book();

    const week = await w.weekOf(w.receptionist, { practitionerId: w.lucia.practitionerId });

    expect(w.mondayFree(week)).toEqual(["12:30", "13:00", "13:30"].map((t) => `${t} Lucía Díaz`));
    expect(week.days[0]!.cards).toEqual([]);
    expect(week.filter).toEqual({ practitionerId: w.lucia.practitionerId, medicalServiceId: null });
  });

  it("narrows to a medical service's practitioner, freeing only starts its duration fits from", async () => {
    const w = await world();
    await w.book();

    const week = await w.weekOf(w.receptionist, { medicalServiceId: w.juanLongService.id });

    expect(w.mondayFree(week)).toEqual(["12:30 Juan Gómez", "13:00 Juan Gómez"]);
    expect(week.filter).toEqual({
      practitionerId: w.juan.practitionerId,
      medicalServiceId: w.juanLongService.id,
    });
  });

  for (const gridMinutes of [20, 60]) {
    it(`frees only cells a booking can start on, on a ${gridMinutes}-minute grid, and each books`, async () => {
      const w = await world();
      await inStorage(w.organization, (database) =>
        database
          .update(practitioner)
          .set({ gridMinutes })
          .where(eq(practitioner.id, w.juan.practitionerId))
          .run(),
      );

      const week = await w.weekOf(w.receptionist, { practitionerId: w.juan.practitionerId });
      const offered = week.days[0]!.freeStarts;

      expect(offered.map((free) => free.start)).toEqual([at("12:00"), at("13:00")]);
      for (const free of offered) {
        await w.book({ patientId: (await w.anotherPatient()).id, start: free.start });
      }
    });
  }

  it("hides cancelled and no-show appointments unless asked for, leaving their cell free", async () => {
    const w = await world();
    const { id } = await w.book();
    await w.setStatus(id, "cancelled");
    const { id: absentId } = await w.book({ start: at("13:00") });
    await w.setStatus(absentId, "noShow");

    for (const caller of [w.receptionist, adminCaller, w.juan.caller]) {
      const week = await w.weekOf(caller, { practitionerId: w.juan.practitionerId });
      expect(week.days[0]!.cards).toEqual([]);
      expect(week.days[0]!.freeStarts).toHaveLength(4);
    }
    const shown = await w.weekOf(w.receptionist, {
      practitionerId: w.juan.practitionerId,
      includeCancelledAndNoShow: true,
    });
    expect(shown.days[0]!.cards).toEqual([
      expect.objectContaining({ id, status: "cancelled" }),
      expect.objectContaining({ id: absentId, status: "noShow" }),
    ]);
    expect(shown.days[0]!.freeStarts).toHaveLength(4);
  });

  it("gives a practitioner their own appointments in full and no patient data about others'", async () => {
    const w = await world();
    const juans = await w.book();
    await w.book({
      patientId: (await w.anotherPatient()).id,
      practitionerId: w.lucia.practitionerId,
      medicalServiceId: w.luciaService.id,
      start: at("12:30"),
    });

    const week = await w.weekOf(w.lucia.caller);

    expect(week.days[0]!.cards).toEqual([
      {
        kind: "busy",
        id: juans.id,
        start: at("12:00"),
        end: at("12:30"),
        practitionerName: "Juan Gómez",
      },
      expect.objectContaining({ kind: "appointment", practitionerId: w.lucia.practitionerId }),
    ]);
    const sent = JSON.stringify(week.days[0]!.cards[0]);
    for (const leak of [w.maria.id, "María", "Trae estudios", w.juanService.id]) {
      expect(sent).not.toContain(leak);
    }
    // A practitioner books only for themselves.
    expect(w.mondayFree(week).every((free) => free.endsWith("Lucía Díaz"))).toBe(true);
  });

  it("sends a practitioner another's appointment only when it meets their own hours in the room", async () => {
    const w = await world();
    // 15:00Z is 12:00 in Buenos Aires, after "Lucía"'s 09:00 to 11:00.
    await w.overbook({ start: at("15:00") });
    const { id } = await w.book({ patientId: (await w.anotherPatient()).id, start: at("13:30") });

    const week = await w.weekOf(w.lucia.caller);

    expect(week.days[0]!.cards).toEqual([expect.objectContaining({ kind: "busy", id })]);
    expect(week.days.slice(1).flatMap((day) => day.cards)).toEqual([]);
  });

  async function luciaOff(w: Awaited<ReturnType<typeof world>>, start: Date, end: Date) {
    await inStorage(w.organization, (database) =>
      database
        .insert(timeOff)
        .values({ practitionerId: w.lucia.practitionerId, startsAt: +start, endsAt: +end })
        .run(),
    );
  }

  it("leaves out another's appointment while the practitioner is on time off", async () => {
    const w = await world();
    await luciaOff(w, at("12:00"), at("13:00"));
    await w.book();
    const { id } = await w.book({ patientId: (await w.anotherPatient()).id, start: at("13:30") });

    const week = await w.weekOf(w.lucia.caller);

    expect(week.days[0]!.cards).toEqual([expect.objectContaining({ kind: "busy", id })]);
  });

  it("cuts another's appointment to the practitioner's hours, on both sides of their time off", async () => {
    const w = await world();
    await luciaOff(w, at("12:30"), at("13:00"));
    // From 09:00 to 11:30 in Buenos Aires: past "Lucía"'s 11:00, and across their time off.
    await w.overbook({ durationMinutes: 150 });

    const week = await w.weekOf(w.lucia.caller);

    expect(week.days[0]!.cards).toMatchObject([
      { kind: "busy", start: at("12:00"), end: at("12:30") },
      { kind: "busy", start: at("13:00"), end: at("14:00") },
    ]);
  });

  it("keeps one block across the practitioner's back-to-back schedules", async () => {
    const w = await world();
    // After their 09:00 to 11:00: 14:00Z to 16:00Z.
    await w.addSchedule({
      practitionerId: w.lucia.practitionerId,
      roomId: w.shared.id,
      startTime: "11:00",
      endTime: "13:00",
    });
    await w.overbook({ start: at("13:30"), durationMinutes: 60 });

    const week = await w.weekOf(w.lucia.caller);

    expect(week.days[0]!.cards).toMatchObject([
      { kind: "busy", start: at("13:30"), end: at("14:30") },
    ]);
  });

  it("offers each viewer the status changes and the undo they may make", async () => {
    const w = await world();
    const { id } = await w.book();
    // Confirmed today, so the change can still be undone.
    await w.setStatus(id, "confirmed");

    const forReception = (await w.weekOf(w.receptionist)).days[0]!.cards[0]!;
    expect(forReception).toMatchObject({
      actions: ["checkedIn", "attended", "cancelled"],
      undoStatus: "booked",
    });
    const forJuan = (await w.weekOf(w.juan.caller)).days[0]!.cards[0]!;
    expect(forJuan).toMatchObject({ actions: ["attended", "cancelled"], undoStatus: "booked" });
  });

  it("draws an overbooking in the room it holds, and lists the office's rooms to move to", async () => {
    const w = await world();
    await w.overbook({
      patientId: (await w.anotherPatient()).id,
      start: at("15:00"),
      roomId: w.otherRoom.id,
    });

    const week = await w.weekOf(w.receptionist, { roomId: w.otherRoom.id });

    expect(week.office.rooms.map((one) => one.name)).toEqual([
      "Consultorio 1",
      "Consultorio 2",
      "Consultorio doble",
    ]);
    expect(week.days[0]!.cards).toEqual([
      expect.objectContaining({ overbooking: true, roomName: "Consultorio 2" }),
    ]);
  });

  it("lists the active rooms by office and opens on the first one when none is asked for", async () => {
    const w = await world();

    expect(
      await w.organization.getCalendarWeek(w.receptionist, { date: "2099-01-07" }),
    ).toMatchObject({
      ok: true,
      roomChoices: [
        {
          officeId: w.office.id,
          officeName: "Sede Centro",
          rooms: [
            { id: w.room.id, name: "Consultorio 1" },
            { id: w.otherRoom.id, name: "Consultorio 2" },
            { id: w.shared.id, name: "Consultorio doble" },
          ],
        },
      ],
      week: { room: { id: w.room.id } },
    });
  });

  async function deactivateLuciaService(w: Awaited<ReturnType<typeof world>>) {
    await inStorage(w.organization, (database) =>
      database
        .update(medicalService)
        .set({ active: false })
        .where(eq(medicalService.id, w.luciaService.id))
        .run(),
    );
  }

  it("ignores a deactivated medical service, keeping the practitioner asked for", async () => {
    const w = await world();
    await deactivateLuciaService(w);

    const week = await w.weekOf(w.receptionist, {
      practitionerId: w.lucia.practitionerId,
      medicalServiceId: w.luciaService.id,
    });

    expect(week.filter).toEqual({ practitionerId: w.lucia.practitionerId, medicalServiceId: null });
    expect(w.mondayFree(week)).toHaveLength(4);
  });

  it("keeps a deactivated medical service's practitioner when the URL names only the service", async () => {
    const w = await world();
    await deactivateLuciaService(w);

    const week = await w.weekOf(w.receptionist, { medicalServiceId: w.luciaService.id });

    expect(week.filter).toEqual({ practitionerId: w.lucia.practitionerId, medicalServiceId: null });
  });

  it("ignores a practitioner and a medical service with nothing in the room that week", async () => {
    const w = await world();

    const week = await w.weekOf(w.receptionist, {
      roomId: w.room.id,
      practitionerId: w.juan.practitionerId,
      medicalServiceId: w.juanService.id,
    });

    expect(week.room.id).toBe(w.room.id);
    expect(week.filter).toEqual({ practitionerId: null, medicalServiceId: null });
  });

  it("ignores a practitioner or a medical service that does not exist", async () => {
    const w = await world();

    const week = await w.weekOf(w.receptionist, {
      practitionerId: w.room.id,
      medicalServiceId: w.room.id,
    });

    expect(week.filter).toEqual({ practitionerId: null, medicalServiceId: null });
    expect(w.mondayFree(week)).toHaveLength(8);
  });

  it("narrows the cards to the medical service filtered by", async () => {
    const w = await world();
    const { id } = await w.book();
    await w.book({
      patientId: (await w.anotherPatient()).id,
      medicalServiceId: w.juanLongService.id,
      start: at("13:00"),
      durationMinutes: 60,
    });

    const week = await w.weekOf(w.receptionist, { medicalServiceId: w.juanService.id });

    expect(week.days[0]!.cards).toEqual([expect.objectContaining({ id })]);
  });

  it("keys each busy block by its appointment, so two overbookings at one start stay two", async () => {
    const w = await world();
    const first = await w.overbook();
    const second = await w.overbook({ patientId: (await w.anotherPatient()).id });

    const week = await w.weekOf(w.lucia.caller);

    expect(week.days[0]!.cards.map((card) => card.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("draws an appointment across midnight on both days, in both weeks", async () => {
    const w = await world();
    // Sunday 2099-01-11 23:30 to Monday 00:30 in Buenos Aires.
    const { id } = await w.overbook({ start: at("02:30", "2099-01-12"), durationMinutes: 60 });

    const sunday = (await w.weekOf(w.receptionist)).days[6]!;
    const monday = (await w.weekOf(w.receptionist, { date: "2099-01-12" })).days[0]!;

    expect(sunday.cards).toEqual([expect.objectContaining({ id })]);
    expect(monday.cards).toEqual([expect.objectContaining({ id })]);
  });

  it("lists a practitioner with an appointment in the room that week but no schedule there", async () => {
    const w = await world();
    await w.overbook({ roomId: w.otherRoom.id, start: at("15:00") });

    const week = await w.weekOf(w.receptionist, { roomId: w.otherRoom.id });

    expect(week.practitioners.map((one) => one.id)).toEqual([w.juan.practitionerId]);
    expect(week.medicalServices.map((one) => one.id).sort()).toEqual(
      [w.juanService.id, w.juanLongService.id].sort(),
    );
    expect(week.days.every((day) => day.freeStarts.length === 0)).toBe(true);
  });

  it("leaves out a practitioner whose only appointment in the room that week was cancelled", async () => {
    const w = await world();
    const booked = await w.overbook({ roomId: w.otherRoom.id, start: at("15:00") });
    await w.setStatus(booked.id, "cancelled");

    const week = await w.weekOf(w.receptionist, { roomId: w.otherRoom.id });

    expect(week.practitioners).toEqual([]);
  });

  it("lists that practitioner with cancelled and no-show shown, only to who books for everyone", async () => {
    const w = await world();
    const booked = await w.overbook({ roomId: w.otherRoom.id, start: at("15:00") });
    await w.setStatus(booked.id, "noShow");
    const query = { roomId: w.otherRoom.id, includeCancelledAndNoShow: true };

    for (const caller of [w.receptionist, adminCaller]) {
      const week = await w.weekOf(caller, { ...query, practitionerId: w.juan.practitionerId });
      expect(week.practitioners.map((one) => one.id)).toEqual([w.juan.practitionerId]);
      expect(week.filter.practitionerId).toBe(w.juan.practitionerId);
      expect(week.days[0]!.cards).toEqual([expect.objectContaining({ id: booked.id })]);
    }
    const lucias = await w.weekOf(w.lucia.caller, query);
    expect(lucias.practitioners).toEqual([]);
  });

  it("refuses a caller who is not a member, and a room that does not exist", async () => {
    const w = await world();

    expect(
      await w.organization.getCalendarWeek({ userId: "user-stranger" }, { date: "2099-01-07" }),
    ).toEqual({ ok: false, reason: "unauthenticated" });
    expect(
      await w.organization.getCalendarWeek(w.receptionist, {
        date: "2099-01-07",
        roomId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "notFound" });
  });
});
