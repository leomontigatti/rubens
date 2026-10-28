import { tz } from "@date-fns/tz";
import { useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import { useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { changeAppointmentRoom } from "#/server/appointments.functions.ts";
import type { DayAppointment } from "#/server/appointments.ts";

import { roomFullMessage } from "#/routes/_app/agenda/-booking.tsx";
import type { BookingSlot, OverbookingOffice } from "#/routes/_app/agenda/-booking.tsx";

// An appointment clicked on the day view: what it is, a move to another room
// of the office, and a sobreturno over it.

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o el propio profesional pueden cambiar el turno.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Elegí un consultorio.",
  notFound: "Ese turno ya no está activo.",
  practitionerInactive: "Ese profesional está inactivo.",
  otherOffice: "Ese consultorio es de otra sede.",
  roomInactive: "Ese consultorio está desactivado.",
  officeInactive: "La sede de ese consultorio está desactivada.",
};

function localTime(instant: Date, timeZone: string) {
  return format(instant, "HH:mm", { in: tz(timeZone) });
}

/** The appointment clicked, with whose column it is in. */
export interface PickedAppointment {
  appointment: DayAppointment;
  practitioner: { id: string; displayName: string };
}

export function AppointmentDialog(props: {
  picked: PickedAppointment | null;
  onClose: () => void;
  /** The office viewed; none until its day has loaded. */
  office: OverbookingOffice | null;
  /** Opens a sobreturno over the appointment, at its time. */
  onOverbook: (slot: BookingSlot) => void;
}) {
  const { picked, office } = props;
  return (
    <Dialog open={picked !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        {picked && office && (
          <AppointmentDetails
            picked={picked}
            office={office}
            onClose={props.onClose}
            onOverbook={props.onOverbook}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AppointmentDetails(props: {
  picked: PickedAppointment;
  office: OverbookingOffice;
  onClose: () => void;
  onOverbook: (slot: BookingSlot) => void;
}) {
  const { picked } = props;
  const { timeZone } = props.office;
  const overbookingSlot = {
    practitionerId: picked.practitioner.id,
    practitionerName: picked.practitioner.displayName,
    start: picked.appointment.start,
    roomName: picked.appointment.roomName,
    timeZone,
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{picked.appointment.patientName}</DialogTitle>
        <DialogDescription>
          {localTime(picked.appointment.start, timeZone)} a{" "}
          {localTime(picked.appointment.end, timeZone)} con {picked.practitioner.displayName} ·{" "}
          {picked.appointment.typeName}
          {picked.appointment.overbooking && " · Sobreturno"}
        </DialogDescription>
      </DialogHeader>
      <RoomMoveForm
        // A new appointment starts the form over.
        key={picked.appointment.id}
        appointment={picked.appointment}
        rooms={props.office.rooms}
        timeZone={timeZone}
        onDone={props.onClose}
      />
      <div>
        <Button type="button" variant="outline" onClick={() => props.onOverbook(overbookingSlot)}>
          Dar sobreturno a esta hora
        </Button>
      </div>
    </>
  );
}

function RoomMoveForm(props: {
  appointment: DayAppointment;
  rooms: { id: string; name: string }[];
  timeZone: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [roomId, setRoomId] = useState(props.appointment.roomId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    let result: Awaited<ReturnType<typeof changeAppointmentRoom>>;
    try {
      result = await changeAppointmentRoom({
        data: { appointmentId: props.appointment.id, roomId },
      });
    } finally {
      setPending(false);
    }
    if (result.ok) {
      await router.invalidate();
      props.onDone();
    } else if (result.reason === "roomFull") {
      setError(roomFullMessage(result.occupants, props.timeZone));
    } else {
      setError(refusalMessages[result.reason]);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="appointment-room">Consultorio</Label>
        <NativeSelect
          id="appointment-room"
          value={roomId}
          onChange={(event) => setRoomId(event.target.value)}
          required
        >
          {props.rooms.map((room) => (
            <NativeSelectOption key={room.id} value={room.id}>
              {room.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <ErrorAlert message={error} />
      <div>
        <Button type="submit" disabled={pending || roomId === props.appointment.roomId}>
          Cambiar consultorio
        </Button>
      </div>
    </form>
  );
}
