import { tz } from "@date-fns/tz";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";

import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import type { DayAppointment } from "#/server/appointments.ts";

import { StatusSection } from "#/routes/_app/agenda/-appointment-status.tsx";

// An appointment clicked on the calendar: what it is and its status, the
// status changes, its room and reception note, and the links to editing them,
// rescheduling, cancelling and an overbooking over it, each on its own page.

function localTime(instant: Date, timeZone: string) {
  return format(instant, "HH:mm", { in: tz(timeZone) });
}

/** The appointment clicked, with its practitioner. */
export interface PickedAppointment {
  appointment: DayAppointment;
  practitioner: { id: string; displayName: string };
}

/** The calendar viewed: its room's office zone, and what an overbooking's page opens on. */
export interface ViewedCalendar {
  timeZone: string;
  roomId: string;
  date: string;
}

export function AppointmentDialog(props: {
  picked: PickedAppointment | null;
  onClose: () => void;
  viewed: ViewedCalendar;
}) {
  const { picked } = props;
  return (
    <Dialog open={picked !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        {picked && (
          <AppointmentDetails
            // A new appointment starts the dialog over.
            key={picked.appointment.id}
            picked={picked}
            viewed={props.viewed}
            onClose={props.onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AppointmentDetails(props: {
  picked: PickedAppointment;
  viewed: ViewedCalendar;
  onClose: () => void;
}) {
  const { appointment, practitioner } = props.picked;
  const { timeZone } = props.viewed;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{appointment.patientName}</DialogTitle>
        <DialogDescription>
          {localTime(appointment.start, timeZone)} a {localTime(appointment.end, timeZone)} con{" "}
          {practitioner.displayName} · {appointment.medicalServiceName}
          {appointment.overbooking && " · Sobreturno"}
        </DialogDescription>
      </DialogHeader>
      <StatusSection appointment={appointment} onDone={props.onClose} />
      <div className="flex flex-col gap-1 text-sm">
        <p>
          <span className="text-muted-foreground">Consultorio:</span> {appointment.roomName}
        </p>
        <p>
          <span className="text-muted-foreground">Nota de recepción:</span>{" "}
          {appointment.receptionNote ?? "sin nota."}
        </p>
      </div>
      <AppointmentLinks picked={props.picked} viewed={props.viewed} />
    </>
  );
}

/** Editing, rescheduling, an overbooking at its time, and its patient. */
function AppointmentLinks(props: { picked: PickedAppointment; viewed: ViewedCalendar }) {
  const { appointment, practitioner } = props.picked;
  const params = { appointmentId: appointment.id };
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link to="/agenda/turnos/$appointmentId/editar" params={params} />}
      >
        Editar
      </Button>
      {/* Rescheduling is open to whoever may cancel: a booked or confirmed appointment. */}
      {appointment.actions.includes("cancelled") && (
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/agenda/turnos/$appointmentId/reprogramar" params={params} />}
        >
          Reprogramar
        </Button>
      )}
      <Button
        variant="outline"
        nativeButton={false}
        render={
          <Link
            to="/agenda/sobreturnos/nuevo"
            search={{
              consultorio: props.viewed.roomId,
              fecha: props.viewed.date,
              inicio: appointment.start.toISOString(),
              profesionales: [practitioner.id],
            }}
          />
        }
      >
        Dar sobreturno a esta hora
      </Button>
      <Button
        variant="ghost"
        nativeButton={false}
        render={<Link to="/pacientes/$patientId" params={{ patientId: appointment.patientId }} />}
      >
        Ver paciente
      </Button>
    </div>
  );
}
