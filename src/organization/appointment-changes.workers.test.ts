import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  RescheduleInput,
  StatusChangeInput,
  WarningConfirmation,
} from "#/lib/appointments.ts";
import { historyChanges } from "#/lib/patients.ts";

import {
  addOffice,
  addRoom,
  adminCaller,
  auditEntriesFor,
  fakeAccounts,
  inStorage,
  setUpBookingWorld,
} from "#/organization/organization.test-support.ts";
import { office as officeTable, practitioner, room as roomTable } from "#/organization/schema.ts";

vi.mock(import("#/organization/accounts.ts"), async (original) => ({
  ...(await original()),
  accountsFor: () => fakeAccounts,
}));

// The office is in Buenos Aires (UTC-3), so 09:00 there is 12:00Z. 2099-01-05
// is a Monday; Juan works there from 09:00 to 11:00 in "Consultorio 1". The
// clock is set to that morning, before the bookings.

type Caller = typeof adminCaller;

function at(time: string, date = "2099-01-05") {
  return new Date(`${date}T${time}:00Z`);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at("11:00"));
});

afterEach(() => {
  vi.useRealTimers();
});

async function world() {
  const booking = await setUpBookingWorld();
  const { organization, juan, lucia, receptionist } = booking;
  await booking.addSchedule({ practitionerId: juan.practitionerId });
  const juanService = await booking.addMedicalService(juan.practitionerId);
  const luciaService = await booking.addMedicalService(lucia.practitionerId);
  const maria = await booking.addPatient("María", "0351 15 555-1234");
  const pedro = await booking.addPatient("Pedro", "0351 15 555-9876");

  /** Books Juan for `patientId` at `start`, 30 minutes, warnings confirmed. */
  async function bookJuan(start = at("12:00"), patientId = maria.id, receptionNote?: string) {
    const created = await booking.book({
      patientId,
      practitionerId: juan.practitionerId,
      medicalServiceId: juanService.id,
      start,
      durationMinutes: 30,
      receptionNote,
      confirmWarnings: true,
    });
    return created.id;
  }

  const reschedule = (
    input: Omit<RescheduleInput, "durationMinutes"> & {
      durationMinutes?: number;
    } & WarningConfirmation,
    caller: Caller = receptionist,
  ) => organization.rescheduleAppointment(caller, { durationMinutes: 30, ...input });

  const change = (
    appointmentId: string,
    status: StatusChangeInput["status"],
    caller: Caller = receptionist,
  ) => organization.changeAppointmentStatus(caller, { appointmentId, status });

  const undo = (appointmentId: string, caller: Caller = receptionist) =>
    organization.undoAppointmentStatus(caller, { appointmentId });

  const cancel = (appointmentId: string, caller: Caller = receptionist) =>
    organization.cancelAppointment(caller, {
      appointmentId,
      cancelledBy: "patient",
      reason: "  Viaja  ",
    });

  const edit = (
    appointmentId: string,
    receptionNote: string,
    caller: Caller = receptionist,
    roomId?: string,
  ) => organization.updateAppointment(caller, { appointmentId, roomId, receptionNote });

  async function juansFreeStarts(appointmentId?: string) {
    const result = await organization.getAvailability(receptionist, {
      practitionerId: juan.practitionerId,
      firstDate: "2099-01-05",
      lastDate: "2099-01-05",
      durationMinutes: 30,
      appointmentId,
    });
    if (!result.ok) {
      throw new Error(`getAvailability refused: ${result.reason}`);
    }
    return result.freeStarts.map((free) => free.start.toISOString());
  }

  /** The audit entries about the appointment after its creation. */
  const changesOf = async (appointmentId: string) =>
    (await auditEntriesFor(organization, appointmentId)).slice(1);

  return {
    ...booking,
    juanService,
    luciaService,
    maria,
    pedro,
    bookJuan,
    reschedule,
    change,
    undo,
    cancel,
    edit,
    juansFreeStarts,
    changesOf,
  };
}

describe("reading one appointment", () => {
  it("draws it as the calendar does, with its office's zone and rooms", async () => {
    const w = await world();
    const id = await w.bookJuan(at("12:00"), w.maria.id, "Trae estudios");

    expect(
      await w.organization.getAppointment(w.receptionist, { appointmentId: id }),
    ).toMatchObject({
      ok: true,
      appointment: {
        id,
        patientName: expect.stringContaining("María"),
        roomId: w.room.id,
        receptionNote: "Trae estudios",
        status: "booked",
        actions: expect.arrayContaining(["confirmed", "cancelled"]),
      },
      office: {
        timeZone: "America/Argentina/Buenos_Aires",
        rooms: [
          { id: w.room.id, name: "Consultorio 1" },
          { id: w.otherRoom.id, name: "Consultorio 2" },
        ],
      },
    });
  });

  it("lists its own room though deactivated, and no other inactive room", async () => {
    const w = await world();
    const id = await w.bookJuan();
    await inStorage(w.organization, (database) =>
      database.update(roomTable).set({ active: false }).run(),
    );

    expect(
      await w.organization.getAppointment(w.receptionist, { appointmentId: id }),
    ).toMatchObject({ ok: true, office: { rooms: [{ id: w.room.id, name: "Consultorio 1" }] } });
  });

  it("is its own practitioner's, and not another practitioner's", async () => {
    const w = await world();
    const id = await w.bookJuan();

    expect(await w.organization.getAppointment(w.juan.caller, { appointmentId: id })).toMatchObject(
      { ok: true },
    );
    expect(await w.organization.getAppointment(w.lucia.caller, { appointmentId: id })).toEqual({
      ok: false,
      reason: "notFound",
    });
  });
});

describe("saving the reception note", () => {
  it("changes the note and audits it about the patient, before and after", async () => {
    const w = await world();
    const id = await w.bookJuan(at("12:00"), w.maria.id, "Trae estudios");

    expect(await w.edit(id, "  Llega tarde  ")).toEqual({ ok: true });

    expect((await w.rowOf(id))!.receptionNote).toBe("Llega tarde");
    expect(await w.changesOf(id)).toEqual([
      expect.objectContaining({
        action: "update",
        patientId: w.maria.id,
        userId: w.receptionist.userId,
        before: { receptionNote: "Trae estudios" },
        after: { receptionNote: "Llega tarde" },
      }),
    ]);
  });

  it("clears the note when left empty", async () => {
    const w = await world();
    const id = await w.bookJuan(at("12:00"), w.maria.id, "Trae estudios");

    expect(await w.edit(id, "   ")).toEqual({ ok: true });

    expect((await w.rowOf(id))!.receptionNote).toBeNull();
  });

  it("is left to whoever may book for the practitioner", async () => {
    const w = await world();
    const id = await w.bookJuan();

    expect(await w.edit(id, "Otra", w.lucia.caller)).toEqual({ ok: false, reason: "forbidden" });
    expect(await w.edit(id, "Propia", w.juan.caller)).toEqual({ ok: true });
    expect((await w.rowOf(id))!.receptionNote).toBe("Propia");
  });
});

describe("moving an appointment to another room", () => {
  it("moves it to a room with space with the note, and audits the room", async () => {
    const w = await world();
    const id = await w.bookJuan();

    expect(await w.edit(id, "Llega tarde", w.receptionist, w.otherRoom.id)).toEqual({ ok: true });

    expect(await w.rowOf(id)).toMatchObject({
      roomId: w.otherRoom.id,
      receptionNote: "Llega tarde",
    });
    expect(await w.changesOf(id)).toEqual([
      expect.objectContaining({ before: { roomId: w.room.id }, after: { roomId: w.otherRoom.id } }),
      expect.objectContaining({ after: { receptionNote: "Llega tarde" } }),
    ]);
  });

  it("leaves it in the room it is in now when only the note is sent", async () => {
    const w = await world();
    const id = await w.bookJuan();
    // Someone else moved it after this page loaded the room it was in.
    await w.edit(id, "", w.receptionist, w.otherRoom.id);

    expect(await w.edit(id, "Llega tarde")).toEqual({ ok: true });

    expect(await w.rowOf(id)).toMatchObject({
      roomId: w.otherRoom.id,
      receptionNote: "Llega tarde",
    });
  });

  it("is refused where the room is full, keeping the room and the note", async () => {
    const w = await world();
    const id = await w.bookJuan(at("12:00"), w.maria.id, "Trae estudios");
    await w.addSchedule({ practitionerId: w.lucia.practitionerId, roomId: w.otherRoom.id });

    expect(await w.edit(id, "Llega tarde", w.receptionist, w.otherRoom.id)).toMatchObject({
      ok: false,
      reason: "roomFull",
      occupants: [{ practitionerName: "Lucía Díaz", kind: "schedule" }],
    });
    expect(await w.rowOf(id)).toMatchObject({ roomId: w.room.id, receptionNote: "Trae estudios" });
  });

  it("is refused to a room of another office", async () => {
    const w = await world();
    const id = await w.bookJuan();
    const norte = await addOffice(w.organization, "Sede Norte");
    const norteRoom = await addRoom(w.organization, norte.id, "Consultorio Norte");

    expect(await w.edit(id, "", w.receptionist, norteRoom.id)).toEqual({
      ok: false,
      reason: "otherOffice",
    });
  });

  it("changes nothing and audits nothing when it is already in that room", async () => {
    const w = await world();
    const id = await w.bookJuan();
    const before = await w.rowOf(id);

    expect(await w.edit(id, "", w.receptionist, w.room.id)).toEqual({ ok: true });

    expect(await w.rowOf(id)).toEqual(before);
    expect(await w.changesOf(id)).toEqual([]);
  });

  it("does not find an appointment that no longer holds its time", async () => {
    const w = await world();
    const id = await w.bookJuan();
    await w.cancel(id);

    expect(await w.edit(id, "", w.receptionist, w.otherRoom.id)).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await w.rowOf(id)).toMatchObject({ roomId: w.room.id });
  });
});

describe("rescheduling", () => {
  /**
   * Juan also works from 14:00 to 16:00 at "Sede Norte", on a 15-minute grid,
   * so a move can land over the appointment's own old time; "Lucía" works from
   * 09:00 to 11:00 in "Consultorio 2".
   */
  async function rescheduleWorld() {
    const w = await world();
    const north = await addOffice(w.organization, "Sede Norte");
    const northRoom = await addRoom(w.organization, north.id, "Norte 1");
    await w.addSchedule({
      practitionerId: w.juan.practitionerId,
      roomId: northRoom.id,
      startTime: "14:00",
      endTime: "16:00",
    });
    await w.addSchedule({ practitionerId: w.lucia.practitionerId, roomId: w.otherRoom.id });
    await inStorage(w.organization, (database) =>
      database
        .update(practitioner)
        .set({ gridMinutes: 15 })
        .where(eq(practitioner.id, w.juan.practitionerId))
        .run(),
    );
    return { ...w, northRoom };
  }

  it("moves the same appointment over its own old time, auditing the previous values", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();

    expect(await w.reschedule({ appointmentId: id, start: at("12:15") })).toEqual({ ok: true });

    expect(await w.rowOf(id)).toMatchObject({ startsAt: +at("12:15"), endsAt: +at("12:45") });
    expect((await w.changesOf(id)).at(-1)).toMatchObject({
      action: "update",
      patientId: w.maria.id,
      before: { start: at("12:00").toISOString(), end: at("12:30").toISOString() },
      after: { start: at("12:15").toISOString(), end: at("12:45").toISOString() },
    });
  });

  it("moves it to another office, in the room of the schedule there", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();

    expect(await w.reschedule({ appointmentId: id, start: at("17:00") })).toEqual({ ok: true });

    expect((await w.rowOf(id))!.roomId).toBe(w.northRoom.id);
    expect((await w.changesOf(id)).at(-1)!.before).toMatchObject({ roomId: w.room.id });
  });

  it("refuses a time that is not free, leaving the appointment", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();
    await w.bookJuan(at("13:00"), w.pedro.id);

    expect(await w.reschedule({ appointmentId: id, start: at("13:00") })).toMatchObject({
      ok: false,
      reason: "notFree",
    });
    expect((await w.rowOf(id))!.startsAt).toBe(+at("12:00"));
  });

  it("warns about the patient's other appointments that day, not about itself", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();
    await w.book({
      patientId: w.maria.id,
      practitionerId: w.lucia.practitionerId,
      medicalServiceId: w.luciaService.id,
      start: at("12:00"),
      durationMinutes: 30,
      confirmWarnings: true,
    });

    const warned = await w.reschedule({ appointmentId: id, start: at("13:00") });
    expect(warned).toMatchObject({ ok: false, reason: "patientWarning" });
    expect(warned.ok === false && warned.reason === "patientWarning" && warned.warnings).toEqual([
      expect.objectContaining({ kind: "sameDay", practitionerName: "Lucía Díaz" }),
    ]);
    expect(
      await w.reschedule({ appointmentId: id, start: at("13:00"), confirmWarnings: true }),
    ).toEqual({ ok: true });
  });

  it("offers the appointment's own time among the free times when asked to", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();

    expect(await w.juansFreeStarts()).not.toContain(at("12:15").toISOString());
    expect(await w.juansFreeStarts(id)).toContain(at("12:15").toISOString());
  });

  it("as an overbooking goes over another appointment and is marked one", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();
    await w.bookJuan(at("13:00"), w.pedro.id);

    expect(
      await w.reschedule({ appointmentId: id, start: at("13:00"), overbooking: true }),
    ).toEqual({ ok: true });
    expect(await w.rowOf(id)).toMatchObject({ overbooking: true, roomId: w.room.id });
  });

  it("as an overbooking outside the schedules, needs a room with space", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();

    expect(
      await w.reschedule({
        appointmentId: id,
        start: at("12:00"),
        overbooking: true,
        roomId: null,
      }),
    ).toEqual({ ok: true });
    expect(
      await w.reschedule({ appointmentId: id, start: at("19:00"), overbooking: true }),
    ).toEqual({ ok: false, reason: "roomRequired" });
    expect(
      await w.reschedule({
        appointmentId: id,
        start: at("12:00"),
        overbooking: true,
        roomId: w.otherRoom.id,
      }),
    ).toMatchObject({ ok: false, reason: "roomFull" });
  });

  it("shows each side of a move to another office's zone in the patient's history", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();
    expect(await w.reschedule({ appointmentId: id, start: at("17:00") })).toEqual({ ok: true });
    // A practitioner's schedules share one zone, so the other zone is set
    // straight on the office: 17:00Z is 12:00 in Lima (UTC-5).
    const northRoomRow = await inStorage(w.organization, (database) =>
      database.select().from(roomTable).where(eq(roomTable.id, w.northRoom.id)).get(),
    );
    await inStorage(w.organization, (database) =>
      database
        .update(officeTable)
        .set({ timeZone: "America/Lima" })
        .where(eq(officeTable.id, northRoomRow!.officeId))
        .run(),
    );

    const result = await w.organization.getPatientHistory(adminCaller, { patientId: w.maria.id });
    if (!result.ok) {
      throw new Error(`getPatientHistory refused: ${result.reason}`);
    }

    const move = result.entries.find((entry) => entry.action === "update");
    expect(move!.timeZones).toEqual({
      before: "America/Argentina/Buenos_Aires",
      after: "America/Lima",
    });
    expect(historyChanges(move!, result.names)).toEqual([
      { field: "Inicio", before: "05/01/2099 09:00", after: "05/01/2099 12:00" },
      { field: "Fin", before: "05/01/2099 09:30", after: "05/01/2099 12:30" },
      { field: "Consultorio", before: "Consultorio 1", after: "Norte 1" },
    ]);
  });

  it("refuses the appointment of a deactivated patient, or practitioner", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();

    await w.organization.setPatientActive(adminCaller, { id: w.maria.id, active: false });
    expect(await w.reschedule({ appointmentId: id, start: at("13:00") })).toEqual({
      ok: false,
      reason: "patientInactive",
    });

    await w.organization.setPatientActive(adminCaller, { id: w.maria.id, active: true });
    const deactivated = await w.organization.setMemberActive(adminCaller, {
      memberId: w.juan.caller.userId,
      active: false,
    });
    expect(deactivated.ok).toBe(true);
    expect(await w.reschedule({ appointmentId: id, start: at("13:00") })).toEqual({
      ok: false,
      reason: "practitionerInactive",
    });
  });

  it("refuses a cancelled appointment", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();
    await w.cancel(id);

    expect(await w.reschedule({ appointmentId: id, start: at("13:00") })).toEqual({
      ok: false,
      reason: "notFound",
    });
  });

  it("refuses another practitioner, and lets the appointment's own reschedule it", async () => {
    const w = await rescheduleWorld();
    const id = await w.bookJuan();

    expect(await w.reschedule({ appointmentId: id, start: at("13:00") }, w.lucia.caller)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await w.reschedule({ appointmentId: id, start: at("13:00") }, w.juan.caller)).toEqual({
      ok: true,
    });
  });
});

describe("status changes", () => {
  it("confirms, checks in and marks attended, auditing each change", async () => {
    const w = await world();
    const id = await w.bookJuan();

    expect(await w.change(id, "confirmed")).toEqual({ ok: true });
    expect(await w.change(id, "checkedIn")).toEqual({ ok: true });
    vi.setSystemTime(at("12:40"));
    expect(await w.change(id, "attended", w.juan.caller)).toEqual({ ok: true });

    expect(await w.rowOf(id)).toMatchObject({
      status: "attended",
      previousStatus: "checkedIn",
      statusChangedAt: +at("12:40"),
    });
    expect(
      (await w.changesOf(id)).map(({ before, after, patientId }) => ({ before, after, patientId })),
    ).toEqual([
      { before: { status: "booked" }, after: { status: "confirmed" }, patientId: w.maria.id },
      { before: { status: "confirmed" }, after: { status: "checkedIn" }, patientId: w.maria.id },
      { before: { status: "checkedIn" }, after: { status: "attended" }, patientId: w.maria.id },
    ]);
  });

  it("refuses a change the transitions do not allow, leaving the row", async () => {
    const w = await world();
    const id = await w.bookJuan();
    await w.change(id, "attended");

    expect(await w.change(id, "confirmed")).toEqual({ ok: false, reason: "notAllowed" });
    expect((await w.rowOf(id))!.status).toBe("attended");
  });

  it("marks a no-show only after the start", async () => {
    const w = await world();
    const id = await w.bookJuan();

    expect(await w.change(id, "noShow")).toEqual({ ok: false, reason: "beforeStart" });
    vi.setSystemTime(at("12:01"));
    expect(await w.change(id, "noShow")).toEqual({ ok: true });
  });

  it("leaves check-in to reception, and another practitioner's appointments alone", async () => {
    const w = await world();
    const id = await w.bookJuan();

    expect(await w.change(id, "checkedIn", w.juan.caller)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await w.change(id, "confirmed", w.lucia.caller)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(await w.change(id, "confirmed", w.juan.caller)).toEqual({ ok: true });
  });

  it("answers notFound for an unknown appointment, and refuses a member with no booking role", async () => {
    const w = await world();
    const id = await w.bookJuan();
    const outsider = { userId: "user-outsider" };

    expect(await w.change(crypto.randomUUID(), "confirmed")).toEqual({
      ok: false,
      reason: "notFound",
    });
    expect(await w.change(id, "confirmed", outsider)).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
  });
});

describe("cancelling", () => {
  it("records who cancelled and why, and frees the time at once", async () => {
    const w = await world();
    const id = await w.bookJuan();
    expect(await w.juansFreeStarts()).not.toContain(at("12:00").toISOString());

    expect(await w.cancel(id, w.juan.caller)).toEqual({ ok: true });

    expect(await w.rowOf(id)).toMatchObject({
      status: "cancelled",
      cancelledBy: "patient",
      cancellationReason: "Viaja",
    });
    expect(await w.juansFreeStarts()).toContain(at("12:00").toISOString());
    expect((await w.changesOf(id)).at(-1)).toMatchObject({
      patientId: w.maria.id,
      before: { status: "booked", cancelledBy: null, cancellationReason: null },
      after: { status: "cancelled", cancelledBy: "patient", cancellationReason: "Viaja" },
    });
  });

  it("frees the time of a no-show too", async () => {
    const w = await world();
    const id = await w.bookJuan();
    vi.setSystemTime(at("12:10"));
    await w.change(id, "noShow");
    vi.setSystemTime(at("11:00"));

    expect(await w.bookJuan(at("12:00"), w.pedro.id)).toEqual(expect.any(String));
  });
});

describe("undo", () => {
  it("restores the previous status once, auditing the undo", async () => {
    const w = await world();
    const id = await w.bookJuan();
    await w.change(id, "confirmed");

    expect(await w.undo(id)).toEqual({ ok: true });
    expect(await w.rowOf(id)).toMatchObject({ status: "booked", previousStatus: null });
    expect((await w.changesOf(id)).at(-1)).toMatchObject({
      before: { status: "confirmed" },
      after: { status: "booked" },
    });
    expect(await w.undo(id)).toEqual({ ok: false, reason: "nothingToUndo" });
  });

  it("is refused the next local day", async () => {
    const w = await world();
    const id = await w.bookJuan();
    await w.change(id, "confirmed");
    // 03:00Z on the 6th is midnight in Buenos Aires.
    vi.setSystemTime(at("03:00", "2099-01-06"));

    expect(await w.undo(id)).toEqual({ ok: false, reason: "tooLate" });
  });

  it("brings a cancellation back, clearing who cancelled", async () => {
    const w = await world();
    const id = await w.bookJuan();
    await w.cancel(id);

    expect(await w.undo(id)).toEqual({ ok: true });
    expect(await w.rowOf(id)).toMatchObject({
      status: "booked",
      cancelledBy: null,
      cancellationReason: null,
    });
  });

  it("refuses to bring a cancellation back once its time was taken", async () => {
    const w = await world();
    const id = await w.bookJuan();
    await w.cancel(id);
    await w.bookJuan(at("12:00"), w.pedro.id);

    expect(await w.undo(id)).toEqual({ ok: false, reason: "timeTaken" });
    expect((await w.rowOf(id))!.status).toBe("cancelled");
  });

  it("brings an overbooking back over the practitioner's own appointment", async () => {
    const w = await world();
    const overbooked = await w.overbook({
      patientId: w.maria.id,
      practitionerId: w.juan.practitionerId,
      medicalServiceId: w.juanService.id,
      start: at("12:00"),
      durationMinutes: 30,
      roomId: null,
    });
    await w.cancel(overbooked.id);
    await w.bookJuan(at("12:00"), w.pedro.id);

    expect(await w.undo(overbooked.id)).toEqual({ ok: true });
  });

  it("refuses to bring a cancellation back to a room filled since, naming who holds it", async () => {
    const w = await world();
    const overbookIn = (practitionerId: string, medicalServiceId: string, patientId: string) =>
      w.overbook({
        patientId,
        practitionerId,
        medicalServiceId,
        start: at("15:00"),
        durationMinutes: 30,
        roomId: w.otherRoom.id,
      });
    const juans = await overbookIn(w.juan.practitionerId, w.juanService.id, w.maria.id);
    await w.cancel(juans.id);
    await overbookIn(w.lucia.practitionerId, w.luciaService.id, w.pedro.id);

    expect(await w.undo(juans.id)).toEqual({
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
    expect((await w.rowOf(juans.id))!.status).toBe("cancelled");
  });

  it("checks no room space for a change that holds time all along", async () => {
    const w = await world();
    const id = await w.bookJuan();
    await w.organization.setRoomActive(adminCaller, { id: w.room.id, active: false });

    expect(await w.change(id, "confirmed")).toEqual({ ok: true });
  });

  it("is left to a role allowed to make the change", async () => {
    const w = await world();
    const id = await w.bookJuan();
    await w.change(id, "checkedIn");

    expect(await w.undo(id, w.juan.caller)).toEqual({ ok: false, reason: "forbidden" });
  });
});
