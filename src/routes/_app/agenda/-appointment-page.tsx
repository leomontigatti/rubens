import { tz } from "@date-fns/tz";
import { format } from "date-fns";
import type { ReactNode } from "react";

import { RefusalMessage } from "#/components/admin-form.tsx";
import type { getAppointmentRecord } from "#/server/appointments.functions.ts";
import type { AppointmentRecord } from "#/organization/appointment-changes.ts";

// What an appointment's pages share: `Editar turno`, `Reprogramar turno` and
// `Cancelar turno`, each opened from its dialog on the calendar or from
// `Turnos a reprogramar`.

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o el propio profesional pueden cambiar el turno.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "No encontramos ese turno.",
  notFound: "No encontramos ese turno.",
};

export type LoadedAppointment = Extract<AppointmentRecord, { ok: true }>;

/** Where `Volver` goes when the page was opened from a link. */
export const appointmentBack = { to: "/agenda" } as const;

/** The page, once the appointment was found and the viewer sees it in full. */
export function AppointmentPage(props: {
  loaded: Awaited<ReturnType<typeof getAppointmentRecord>>;
  children: (loaded: LoadedAppointment) => ReactNode;
}) {
  const { loaded } = props;
  if (!loaded.ok) {
    return <RefusalMessage message={refusalMessages[loaded.reason]} />;
  }
  return props.children(loaded);
}

/** Who and when, under each page's title: `María Fernández, 02/11/2026 09:00 con Laura Gómez`. */
export function appointmentSummary({ appointment, office }: LoadedAppointment): string {
  const when = format(appointment.start, "dd/MM/yyyy HH:mm", { in: tz(office.timeZone) });
  return `${appointment.patientName}, ${when} con ${appointment.practitionerName} · ${appointment.medicalServiceName}`;
}
