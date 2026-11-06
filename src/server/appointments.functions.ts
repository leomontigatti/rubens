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

import { withOrganization } from "#/server/with-organization.ts";

// The object validates the input, names the roles that may act and decides on
// whose appointments, so each validator here only names the type.

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
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.getAppointment(caller, data)),
  );

export const saveAppointment = createServerFn({ method: "POST" })
  .validator((data: AppointmentUpdate) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.updateAppointment(caller, data)),
  );

export const setAppointmentStatus = createServerFn({ method: "POST" })
  .validator((data: StatusChangeInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.changeAppointmentStatus(caller, data)),
  );

export const markAppointmentCancelled = createServerFn({ method: "POST" })
  .validator((data: CancellationInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.cancelAppointment(caller, data)),
  );

export const undoStatusChange = createServerFn({ method: "POST" })
  .validator((data: AppointmentIdInput) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.undoAppointmentStatus(caller, data)),
  );

export const moveAppointment = createServerFn({ method: "POST" })
  .validator((data: RescheduleInput & WarningConfirmation) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.rescheduleAppointment(caller, data)),
  );

export const getPatientAppointments = createServerFn({ method: "GET" })
  .validator((data: { patientId: string }) => data)
  .handler(({ data }) =>
    withOrganization((organization, caller) => organization.getPatientAppointments(caller, data)),
  );

export const getToReschedule = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.listToReschedule(caller)),
);

export const getToRescheduleCount = createServerFn({ method: "GET" }).handler(() =>
  withOrganization((organization, caller) => organization.countToReschedule(caller)),
);
