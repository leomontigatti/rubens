import { createServerFn } from "@tanstack/react-start";

import type {
  BookingInput,
  OfficeDayQuery,
  OverbookingInput,
  RoomMove,
  WarningConfirmation,
} from "#/lib/appointments.ts";

import { bookOverbooking, moveAppointmentRoom } from "#/server/appointment-rooms.ts";
import { bookAppointment, getOfficeDay } from "#/server/appointments.ts";
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
