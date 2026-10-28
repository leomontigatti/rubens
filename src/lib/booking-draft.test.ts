import { describe, expect, it } from "vite-plus/test";

import {
  bookingReducer,
  bookingRequestOf,
  freeStartsQueryOf,
  initialBookingDraft,
  overbookingRequestOf,
  rescheduleQueryOf,
} from "#/lib/booking-draft.ts";
import type { BookingDraft, BookingEvent } from "#/lib/booking-draft.ts";

const zone = "America/Argentina/Buenos_Aires";
const nine = { start: new Date("2099-01-05T12:00:00Z"), roomName: "Consultorio 1", timeZone: zone };
const ten = {
  start: new Date("2099-01-05T13:00:00Z"),
  officeName: "Sede Centro",
  roomName: "Consultorio 1",
  timeZone: zone,
};
const consulta = { id: "type-1", durationMinutes: 40 };

function run(draft: BookingDraft, ...events: BookingEvent[]) {
  return events.reduce(bookingReducer, draft);
}

const fromSlot = initialBookingDraft({ ...nine, practitionerId: "juan" }, ["juan", "lucia"]);

describe("the booking draft", () => {
  it("starts from a clicked free time with its practitioner and start, or the only practitioner", () => {
    expect(fromSlot).toMatchObject({ practitionerId: "juan", start: nine });
    expect(initialBookingDraft(null, ["juan"])).toMatchObject({ practitionerId: "juan" });
    expect(initialBookingDraft(null, ["juan", "lucia"])).toMatchObject({ practitionerId: "" });
  });

  it("takes the type's duration as a default the user can change", () => {
    const typed = run(fromSlot, { type: "typeChosen", appointmentType: consulta });
    expect(typed.durationMinutes).toBe(40);
    expect(run(typed, { type: "durationChanged", durationMinutes: 60 }).durationMinutes).toBe(60);
  });

  it("drops the type, duration and start when another practitioner is chosen", () => {
    const changed = run(
      fromSlot,
      { type: "typeChosen", appointmentType: consulta },
      { type: "practitionerChosen", practitionerId: "lucia" },
    );

    expect(changed).toMatchObject({ type: null, durationMinutes: null, start: null });
  });

  it("drops the picked start and offers the fresh ones when the time was taken", () => {
    const taken = run(fromSlot, { type: "timeTaken", freshStarts: [ten] });
    expect(taken).toMatchObject({ start: null, freshStarts: [ten] });

    expect(run(taken, { type: "startPicked", start: ten })).toMatchObject({
      start: ten,
      freshStarts: null,
    });
  });

  it("clears a patient warning once the time or the patient changes, not the note", () => {
    const warned = run(fromSlot, {
      type: "warned",
      warnings: [
        {
          kind: "sameDay",
          start: ten.start,
          end: ten.start,
          practitionerName: "Lucía",
          timeZone: zone,
        },
      ],
    });

    expect(run(warned, { type: "noteChanged", receptionNote: "x" }).warnings).not.toBeNull();
    expect(run(warned, { type: "startPicked", start: ten }).warnings).toBeNull();
    expect(run(warned, { type: "patientPicked", patientId: "pedro" }).warnings).toBeNull();
  });
});

describe("what a draft books", () => {
  it("needs a patient, a type, a duration of 1 to 720 minutes and a start", () => {
    const ready = run(
      fromSlot,
      { type: "patientPicked", patientId: "maria" },
      { type: "typeChosen", appointmentType: consulta },
      { type: "noteChanged", receptionNote: "Trae estudios" },
    );

    expect(bookingRequestOf(ready)).toEqual({
      patientId: "maria",
      practitionerId: "juan",
      appointmentTypeId: "type-1",
      start: nine.start,
      durationMinutes: 40,
      receptionNote: "Trae estudios",
    });
    expect(
      bookingRequestOf(run(ready, { type: "durationChanged", durationMinutes: 0 })),
    ).toBeNull();
    expect(bookingRequestOf(run(ready, { type: "patientPicked", patientId: null }))).toBeNull();
    expect(bookingRequestOf(run(ready, { type: "startPicked", start: null }))).toBeNull();
  });
});

describe("what an overbooking draft books", () => {
  const ready = run(
    initialBookingDraft(null, ["juan"]),
    { type: "patientPicked", patientId: "maria" },
    { type: "typeChosen", appointmentType: consulta },
  );

  it("books the local date and time in the office's zone, in the schedule's room unless one is picked", () => {
    expect(
      overbookingRequestOf(ready, { date: "2099-01-05", time: "09:10", roomId: "" }, zone),
    ).toEqual({
      patientId: "maria",
      practitionerId: "juan",
      appointmentTypeId: "type-1",
      start: new Date("2099-01-05T12:10:00Z"),
      durationMinutes: 40,
      receptionNote: "",
      roomId: null,
    });
    expect(
      overbookingRequestOf(ready, { date: "2099-01-05", time: "09:10", roomId: "room-3" }, zone),
    ).toMatchObject({ roomId: "room-3" });
  });

  it("needs a date and a time", () => {
    expect(overbookingRequestOf(ready, { date: "", time: "09:10", roomId: "" }, zone)).toBeNull();
    expect(
      overbookingRequestOf(ready, { date: "2099-01-05", time: "", roomId: "" }, zone),
    ).toBeNull();
  });
});

describe("the free times a new booking asks for", () => {
  it("asks for the week from the date once a practitioner, a type and a duration are set", () => {
    const fresh = initialBookingDraft(null, ["juan"]);
    expect(freeStartsQueryOf(fresh, "2099-01-05")).toBeNull();

    const typed = run(fresh, { type: "typeChosen", appointmentType: consulta });
    expect(freeStartsQueryOf(typed, "2099-01-05")).toEqual({
      practitionerId: "juan",
      firstDate: "2099-01-05",
      lastDate: "2099-01-11",
      durationMinutes: 40,
    });
    expect(
      freeStartsQueryOf(
        run(typed, { type: "durationChanged", durationMinutes: 721 }),
        "2099-01-05",
      ),
    ).toBeNull();
  });
});

describe("the reschedule picker's query", () => {
  const moved = { id: "appointment-1", practitionerId: "juan" };

  it("asks a week of free times with the appointment's own time counted free", () => {
    expect(rescheduleQueryOf(moved, "2099-01-05", 45)).toEqual({
      practitionerId: "juan",
      firstDate: "2099-01-05",
      lastDate: "2099-01-11",
      durationMinutes: 45,
      appointmentId: "appointment-1",
    });
  });

  it("asks nothing while the duration is not a valid one", () => {
    expect(rescheduleQueryOf(moved, "2099-01-05", 0)).toBeNull();
    expect(rescheduleQueryOf(moved, "2099-01-05", Number.NaN)).toBeNull();
  });
});
