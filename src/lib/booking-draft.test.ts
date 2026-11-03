import { describe, expect, it } from "vite-plus/test";

import {
  bookingRequestOf,
  freeStartsQueryOf,
  initialBookingValues,
  overbookingRequestOf,
  rescheduleQueryOf,
  rescheduleRequestOf,
} from "#/lib/booking-draft.ts";
import type { BookingValues } from "#/lib/booking-draft.ts";

const zone = "America/Argentina/Buenos_Aires";
// Ids are uuids, as the booking schemas read them.
const juan = "6f1c2b9e-4a3d-4e8f-9b2a-1c3d5e7f9a01";
const lucia = "6f1c2b9e-4a3d-4e8f-9b2a-1c3d5e7f9a02";
const maria = { id: "6f1c2b9e-4a3d-4e8f-9b2a-1c3d5e7f9a04", name: "María Fernández" };
const room3 = "6f1c2b9e-4a3d-4e8f-9b2a-1c3d5e7f9a05";
const nine = { start: new Date("2099-01-05T12:00:00Z"), roomName: "Consultorio 1", timeZone: zone };
const consulta = { id: "6f1c2b9e-4a3d-4e8f-9b2a-1c3d5e7f9a03", durationMinutes: 40 };

describe("a new booking form", () => {
  it("starts from a clicked free cell with its start, and its only free practitioner", () => {
    expect(initialBookingValues(nine, [juan], "2099-01-05")).toMatchObject({
      practitionerId: juan,
      start: nine,
      medicalServiceId: "",
      durationMinutes: "",
    });
    expect(initialBookingValues(nine, [juan, lucia], "2099-01-05")).toMatchObject({
      practitionerId: "",
      start: nine,
    });
  });

  it("takes the medical service the calendar is narrowed to, with its duration", () => {
    expect(
      initialBookingValues({ ...nine, medicalService: consulta }, [juan], "2099-01-05"),
    ).toMatchObject({ medicalServiceId: consulta.id, durationMinutes: "40" });
  });

  it("gives an overbooking the start's local date and time, or the date viewed", () => {
    expect(initialBookingValues(nine, [juan], "2099-01-12")).toMatchObject({
      date: "2099-01-05",
      time: "09:00",
    });
    expect(initialBookingValues(null, [juan], "2099-01-12")).toMatchObject({
      date: "2099-01-12",
      time: "",
      start: null,
    });
  });
});

const ready: BookingValues = {
  ...initialBookingValues(nine, [juan], "2099-01-05"),
  patient: maria,
  medicalServiceId: consulta.id,
  durationMinutes: "40",
  receptionNote: "Trae estudios",
};

function refusedPaths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("what a booking form books", () => {
  it("books the patient, practitioner, medical service, duration and start", () => {
    expect(bookingRequestOf(ready).data).toEqual({
      patientId: maria.id,
      practitionerId: juan,
      medicalServiceId: consulta.id,
      start: nine.start,
      durationMinutes: 40,
      receptionNote: "Trae estudios",
    });
  });

  it("refuses what is missing, and a duration outside 1 to 720 minutes", () => {
    const empty = initialBookingValues(null, [], "2099-01-05");
    expect(refusedPaths(bookingRequestOf(empty))).toEqual([
      "patientId",
      "practitionerId",
      "medicalServiceId",
      "start",
      "durationMinutes",
    ]);
    expect(refusedPaths(bookingRequestOf({ ...ready, durationMinutes: "721" }))).toEqual([
      "durationMinutes",
    ]);
  });
});

describe("what an overbooking form books", () => {
  const typed = { ...ready, start: null, date: "2099-01-05", time: "09:10" };

  it("books the local date and time in the office's zone, in the schedule's room unless one is picked", () => {
    expect(overbookingRequestOf(typed, zone).data).toMatchObject({
      start: new Date("2099-01-05T12:10:00Z"),
      roomId: null,
    });
    expect(overbookingRequestOf({ ...typed, roomId: room3 }, zone).data).toMatchObject({
      roomId: room3,
    });
  });

  it("needs a date and a time", () => {
    expect(refusedPaths(overbookingRequestOf({ ...typed, date: "" }, zone))).toEqual(["start"]);
    expect(refusedPaths(overbookingRequestOf({ ...typed, time: "" }, zone))).toEqual(["start"]);
  });
});

describe("the free times a new booking asks for", () => {
  it("asks for the week from the date once a practitioner, a medical service and a duration are set", () => {
    const fresh = initialBookingValues(null, [juan], "2099-01-05");
    expect(freeStartsQueryOf(fresh)).toBeNull();

    const withMedicalService = { ...fresh, medicalServiceId: consulta.id, durationMinutes: "40" };
    expect(freeStartsQueryOf(withMedicalService)).toEqual({
      practitionerId: juan,
      firstDate: "2099-01-05",
      lastDate: "2099-01-11",
      durationMinutes: 40,
    });
    expect(freeStartsQueryOf({ ...withMedicalService, durationMinutes: "721" })).toBeNull();
  });

  it("asks nothing while the date is cleared or half typed", () => {
    const ready = {
      ...initialBookingValues(null, [juan], ""),
      medicalServiceId: consulta.id,
      durationMinutes: "40",
    };
    expect(freeStartsQueryOf(ready)).toBeNull();
    expect(freeStartsQueryOf({ ...ready, freeFrom: "0002-01-0" })).toBeNull();
  });
});

describe("the reschedule picker's query", () => {
  const moved = { id: "appointment-1", practitionerId: juan };

  it("asks a week of free times with the appointment's own time counted free", () => {
    expect(rescheduleQueryOf(moved, "2099-01-05", 45)).toEqual({
      practitionerId: juan,
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

  it("asks nothing while the date is cleared", () => {
    expect(rescheduleQueryOf(moved, "", 45)).toBeNull();
  });
});

describe("what a reschedule form moves", () => {
  const appointmentId = "6f1c2b9e-4a3d-4e8f-9b2a-1c3d5e7f9a06";

  it("moves the appointment to the start picked, for the duration typed", () => {
    expect(
      rescheduleRequestOf(
        { durationMinutes: "45", freeFrom: "2099-01-05", start: nine },
        appointmentId,
      ).data,
    ).toEqual({
      appointmentId,
      start: nine.start,
      durationMinutes: 45,
      overbooking: false,
      roomId: null,
    });
  });

  it("refuses a missing start and a duration outside 1 to 720 minutes", () => {
    expect(
      refusedPaths(
        rescheduleRequestOf(
          { durationMinutes: "", freeFrom: "2099-01-05", start: null },
          appointmentId,
        ),
      ),
    ).toEqual(["start", "durationMinutes"]);
  });
});
