import { createServerFn } from "@tanstack/react-start";

import type {
  AppointmentIdInput,
  AppointmentUpdate,
  BookingInput,
  CalendarWeekQuery,
  CancellationInput,
  OverbookingInput,
  RescheduleInput,
  StatusChangeInput,
  WarningConfirmation,
} from "#/lib/appointments.ts";

import { getAppointment, updateAppointment } from "#/server/appointment-edit.ts";
import { rescheduleAppointment } from "#/server/appointment-reschedule.ts";
import { bookOverbooking } from "#/server/appointment-rooms.ts";
import {
  cancelAppointment,
  changeAppointmentStatus,
  undoAppointmentStatus,
} from "#/server/appointment-statuses.ts";
import { bookAppointment } from "#/server/appointments.ts";
import { getCalendarWeek } from "#/server/calendar-week.ts";
import type { PatientAppointment } from "#/server/patient-appointments.ts";
import { countToReschedule, listToReschedule } from "#/server/to-reschedule.ts";
import { withActor } from "#/server/with-actor.ts";

// The services validate their input and decide for whom the actor may book, so
// each validator here only names the type. Naming the booking roles here as
// well refuses everyone else before a transaction opens.
const bookers = { roles: ["admin", "receptionist", "practitioner"] } as const;

export const getCalendarWeekView = createServerFn({ method: "GET" })
  .validator((data: CalendarWeekQuery) => data)
  .handler(({ data }) => withActor(bookers, (actor) => getCalendarWeek(actor, data)));

export const addAppointment = createServerFn({ method: "POST" })
  .validator((data: BookingInput & WarningConfirmation) => data)
  .handler(({ data }) => withActor(bookers, (actor) => bookAppointment(actor, data)));

export const addOverbooking = createServerFn({ method: "POST" })
  .validator((data: OverbookingInput & WarningConfirmation) => data)
  .handler(({ data }) => withActor(bookers, (actor) => bookOverbooking(actor, data)));

export const getAppointmentRecord = createServerFn({ method: "GET" })
  .validator((data: AppointmentIdInput) => data)
  .handler(({ data }) => withActor(bookers, (actor) => getAppointment(actor, data)));

export const saveAppointment = createServerFn({ method: "POST" })
  .validator((data: AppointmentUpdate) => data)
  .handler(({ data }) => withActor(bookers, (actor) => updateAppointment(actor, data)));

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
  // Until appointments port (#137), a patient's page lists none, so it loads
  // with no Postgres behind it.
  .handler(() => ({
    ok: true as const,
    upcoming: [] as PatientAppointment[],
    past: [] as PatientAppointment[],
  }));

export const getToReschedule = createServerFn({ method: "GET" }).handler(() =>
  withActor(bookers, (actor) => listToReschedule(actor)),
);

export const getToRescheduleCount = createServerFn({ method: "GET" }).handler(() =>
  withActor(bookers, (actor) => countToReschedule(actor)),
);
