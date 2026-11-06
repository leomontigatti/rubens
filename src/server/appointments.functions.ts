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
import {
  cancelAppointment,
  changeAppointmentStatus,
  undoAppointmentStatus,
} from "#/server/appointment-statuses.ts";
import { listToReschedule } from "#/server/to-reschedule.ts";
import { withActor } from "#/server/with-actor.ts";
import { withOrganization } from "#/server/with-organization.ts";

// The object and the services validate their input and decide for whom the
// caller may book, so each validator here only names the type. The object
// names the booking roles itself; for the services not ported yet (#138),
// naming them here refuses everyone else before a transaction opens.
const bookers = { roles: ["admin", "receptionist", "practitioner"] } as const;

export const getCalendarWeekView = createServerFn({ method: "GET" })
  .validator((data: CalendarWeekQuery) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.getCalendarWeek(caller, data)),
  );

export const addAppointment = createServerFn({ method: "POST" })
  .validator((data: BookingInput & WarningConfirmation) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.bookAppointment(caller, data)),
  );

export const addOverbooking = createServerFn({ method: "POST" })
  .validator((data: OverbookingInput & WarningConfirmation) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.bookOverbooking(caller, data)),
  );

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
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.getPatientAppointments(caller, data)),
  );

export const getToReschedule = createServerFn({ method: "GET" }).handler(() =>
  withActor(bookers, (actor) => listToReschedule(actor)),
);
