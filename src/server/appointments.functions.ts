import { createServerFn } from "@tanstack/react-start";

import type {
  AppointmentIdInput,
  BookingInput,
  CancellationInput,
  OfficeDayQuery,
  OverbookingInput,
  RescheduleInput,
  RoomMove,
  StatusChangeInput,
  WarningConfirmation,
} from "#/lib/appointments.ts";

import { rescheduleAppointment } from "#/server/appointment-reschedule.ts";
import { bookOverbooking, moveAppointmentRoom } from "#/server/appointment-rooms.ts";
import {
  cancelAppointment,
  changeAppointmentStatus,
  undoAppointmentStatus,
} from "#/server/appointment-statuses.ts";
import { bookAppointment, getOfficeDay } from "#/server/appointments.ts";
import { listPatientAppointments } from "#/server/patient-appointments.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and decide for whom the actor may book, so
// each validator here only names the type. Naming the booking roles here as
// well refuses everyone else before a transaction opens.
const bookers = { roles: ["admin", "receptionist", "practitioner"] } as const;

export const getOfficeDayView = createServerFn({ method: "GET" })
  .validator((data: OfficeDayQuery) => data)
  .handler(({ data }) => withActor(bookers, (actor) => getOfficeDay(actor, data)));

export const addAppointment = createServerFn({ method: "POST" })
  .validator((data: BookingInput & WarningConfirmation) => data)
  .handler(({ data }) => withActor(bookers, (actor) => bookAppointment(actor, data)));

export const addOverbooking = createServerFn({ method: "POST" })
  .validator((data: OverbookingInput & WarningConfirmation) => data)
  .handler(({ data }) => withActor(bookers, (actor) => bookOverbooking(actor, data)));

export const changeAppointmentRoom = createServerFn({ method: "POST" })
  .validator((data: RoomMove) => data)
  .handler(({ data }) => withActor(bookers, (actor) => moveAppointmentRoom(actor, data)));

export const setAppointmentStatus = createServerFn({ method: "POST" })
  .validator((data: StatusChangeInput) => data)
  .handler(({ data }) => withActor(bookers, (actor) => changeAppointmentStatus(actor, data)));

export const markAppointmentCancelled = createServerFn({ method: "POST" })
  .validator((data: CancellationInput) => data)
  .handler(({ data }) => withActor(bookers, (actor) => cancelAppointment(actor, data)));

export const undoStatusChange = createServerFn({ method: "POST" })
  .validator((data: AppointmentIdInput) => data)
  .handler(({ data }) => withActor(bookers, (actor) => undoAppointmentStatus(actor, data)));

export const moveAppointment = createServerFn({ method: "POST" })
  .validator((data: RescheduleInput & WarningConfirmation) => data)
  .handler(({ data }) => withActor(bookers, (actor) => rescheduleAppointment(actor, data)));

export const getPatientAppointments = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => data)
  .handler(({ data }) => withActor(bookers, (actor) => listPatientAppointments(actor, data)));
