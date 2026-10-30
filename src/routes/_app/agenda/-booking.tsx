import { tz } from "@date-fns/tz";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import { useReducer, useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  bookingReducer,
  bookingRequestOf,
  freeStartsQueryOf,
  initialBookingDraft,
  overbookingRequestOf,
} from "#/lib/booking-draft.ts";
import type {
  BookingDraft,
  BookingEvent,
  BookingWarning,
  OverbookingPlace,
  PickedStart,
} from "#/lib/booking-draft.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import { getMedicalServices } from "#/server/medical-services.functions.ts";
import type { RoomOccupant } from "#/server/appointment-rooms.ts";
import { addAppointment, addOverbooking } from "#/server/appointments.functions.ts";
import type { AvailableStart } from "#/server/availability.ts";
import { ReceptionNoteField } from "#/routes/_app/agenda/-appointment-note.tsx";
import { FreeStartList, FreeStartsOfWeek } from "#/routes/_app/agenda/-free-starts.tsx";
import { PatientPicker } from "#/routes/_app/agenda/-patient-picker.tsx";

// Booking a patient, from either entry: a free cell clicked on the calendar,
// which fixes the time and the room, and the practitioner unless several are
// free there, or "Nuevo turno", which picks the practitioner, the medical
// service and then a free time for that duration. An overbooking takes a
// typed date and time instead, and a room when it falls outside the
// practitioner's schedules.

export interface BookingSlot extends PickedStart {
  /** Who can be booked there: the practitioners free in the cell, or the overbooked one. */
  practitioners: { id: string; displayName: string }[];
  /** The medical service the calendar is narrowed to. */
  medicalService?: { id: string; durationMinutes: number } | null;
}

/** The copy for every refusal booking can return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o el propio profesional pueden dar turnos.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá la duración y la nota de recepción.",
  notFound: "No encontramos el paciente, el profesional o la prestación.",
  practitionerInactive: "Ese profesional está inactivo.",
  patientInactive: "Ese paciente está inactivo.",
  medicalServiceInactive: "Esa prestación está desactivada.",
  notFree: "Ese horario ya no está libre para esa duración. Elegí otro.",
  roomRequired: "Ese horario está fuera de los horarios del profesional: elegí un consultorio.",
  timeOff: "El profesional no atiende a esa hora: tiene una ausencia cargada.",
  closed: "La sede está cerrada a esa hora.",
  roomInactive: "Ese consultorio está desactivado.",
  officeInactive: "La sede de ese consultorio está desactivada.",
};

/** The refusals that mean someone took the time since the calendar was read. */
const takenRefusals: readonly string[] = ["timeTaken", "roomFull"];

/**
 * Why the room has no space: who holds it at that time. None when the
 * appointment that took it was gone by the time the server looked again.
 */
export function roomFullMessage(occupants: readonly RoomOccupant[], timeZone: string): string {
  if (occupants.length === 0) {
    return "El consultorio se ocupó a esa hora mientras guardabas. Probá de nuevo.";
  }
  const held = occupants.map(
    (occupant) =>
      `${occupant.practitionerName} (${occupant.kind === "schedule" ? "horario" : "turno"} de ${localTime(occupant.start, timeZone)} a ${localTime(occupant.end, timeZone)})`,
  );
  return `Ese consultorio no tiene lugar a esa hora. Lo ocupan: ${held.join(", ")}.`;
}

function localTime(instant: Date, timeZone: string) {
  return format(instant, "HH:mm", { in: tz(timeZone) });
}

function localDateTime(instant: Date, timeZone: string) {
  return format(instant, "dd/MM/yyyy HH:mm", { in: tz(timeZone) });
}

/** Where an overbooking can go: the office's rooms, its local times read in its zone. */
export interface OverbookingOffice {
  rooms: { id: string; name: string }[];
  timeZone: string;
}

export function BookingDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The free cell clicked on the calendar, or the appointment an overbooking goes over. */
  slot: BookingSlot | null;
  practitioners: { id: string; displayName: string }[];
  defaultDate: string;
  /** Set for an overbooking. */
  overbooking: OverbookingOffice | null;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.overbooking ? "Sobreturno" : "Nuevo turno"}</DialogTitle>
          {props.slot?.practitioners.length === 1 && (
            <DialogDescription>{props.slot.practitioners[0]!.displayName}</DialogDescription>
          )}
        </DialogHeader>
        {props.open && (
          <BookingForm
            slot={props.slot}
            practitioners={props.practitioners}
            defaultDate={props.defaultDate}
            overbooking={props.overbooking}
            onDone={() => props.onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Dispatch = (event: BookingEvent) => void;

type BookingRefusal =
  | Exclude<Awaited<ReturnType<typeof addAppointment>>, { ok: true }>
  | Exclude<Awaited<ReturnType<typeof addOverbooking>>, { ok: true }>;

/** An overbooking's place to start from: the clicked appointment's time, or the date viewed. */
function initialPlace(slot: BookingSlot | null, defaultDate: string): OverbookingPlace {
  if (!slot) {
    return { date: defaultDate, time: "", roomId: "" };
  }
  const [date, time] = format(slot.start, "yyyy-MM-dd HH:mm", { in: tz(slot.timeZone) }).split(" ");
  return { date: date!, time: time!, roomId: "" };
}

/** What the form books: a booking at a free start, or an overbooking at the typed place. */
function requestOf(draft: BookingDraft, place: OverbookingPlace, office: OverbookingOffice | null) {
  if (!office) {
    const booking = bookingRequestOf(draft);
    return booking && { overbooking: false as const, data: booking };
  }
  const overbooking = overbookingRequestOf(draft, place, office.timeZone);
  return overbooking && { overbooking: true as const, data: overbooking };
}

function send(request: NonNullable<ReturnType<typeof requestOf>>, confirmWarnings: boolean) {
  return request.overbooking
    ? addOverbooking({ data: { ...request.data, confirmWarnings } })
    : addAppointment({ data: { ...request.data, confirmWarnings } });
}

/** What a refusal does to the draft. */
function refusalEvent(refusal: BookingRefusal, timeZone: string): BookingEvent {
  switch (refusal.reason) {
    case "roomFull":
      return { type: "failed", error: roomFullMessage(refusal.occupants, timeZone) };
    case "patientWarning":
      return { type: "warned", warnings: refusal.warnings };
    case "timeTaken":
      return { type: "timeTaken", freshStarts: refusal.freeStarts };
    default:
      return { type: "failed", error: refusalMessages[refusal.reason] };
  }
}

/**
 * Whom the form books for: the practitioners free in the clicked cell, asking
 * only when there are several, or anyone from "Nuevo turno".
 */
function practitionerChoices(
  slot: BookingSlot | null,
  practitioners: { id: string; displayName: string }[],
) {
  if (!slot) {
    return { choices: practitioners, ask: true };
  }
  return { choices: slot.practitioners, ask: slot.practitioners.length > 1 };
}

function BookingForm(props: {
  slot: BookingSlot | null;
  practitioners: { id: string; displayName: string }[];
  defaultDate: string;
  overbooking: OverbookingOffice | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const { choices, ask } = practitionerChoices(props.slot, props.practitioners);
  const [draft, dispatch] = useReducer(
    bookingReducer,
    initialBookingDraft(
      props.slot,
      choices.map((practitioner) => practitioner.id),
    ),
  );
  const [pending, setPending] = useState(false);
  const [place, setPlace] = useState(() => initialPlace(props.slot, props.defaultDate));
  const request = requestOf(draft, place, props.overbooking);

  async function book(confirmWarnings: boolean) {
    if (!request) {
      return;
    }
    setPending(true);
    let result: Awaited<ReturnType<typeof send>>;
    try {
      result = await send(request, confirmWarnings);
    } finally {
      setPending(false);
    }
    if (result.ok) {
      await router.invalidate();
      props.onDone();
      return;
    }
    await settle(result);
  }

  async function settle(refusal: BookingRefusal) {
    // An overbooking's times are read in its office's zone; a booking's refusals hold none.
    dispatch(refusalEvent(refusal, props.overbooking?.timeZone ?? defaultTimeZone));
    if (takenRefusals.includes(refusal.reason)) {
      // The calendar behind the dialog shows the time taken too.
      await router.invalidate();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void book(false);
  }

  return (
    // The picker sits outside the form: its quick registration is a form of its own.
    <div className="flex flex-col gap-4">
      <PatientPicker onChange={(patientId) => dispatch({ type: "patientPicked", patientId })} />
      <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
        {ask && (
          <PractitionerField
            practitioners={choices}
            value={draft.practitionerId}
            dispatch={dispatch}
          />
        )}
        <TypeAndDuration draft={draft} dispatch={dispatch} />
        {props.overbooking ? (
          <OverbookingFields
            place={place}
            rooms={props.overbooking.rooms}
            onChange={(changed) => {
              setPlace(changed);
              // A new place drops what the last attempt answered.
              dispatch({ type: "startPicked", start: draft.start });
            }}
          />
        ) : (
          <FreeStart
            slot={props.slot}
            draft={draft}
            defaultDate={props.defaultDate}
            dispatch={dispatch}
          />
        )}
        <ReceptionNoteField
          id="booking-note"
          value={draft.receptionNote}
          onChange={(receptionNote) => dispatch({ type: "noteChanged", receptionNote })}
        />
        <PatientWarnings
          warnings={draft.warnings}
          pending={pending}
          onConfirm={() => void book(true)}
          confirmLabel="Dar turno igual"
        />
        <ErrorAlert message={draft.error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || !request}>
            Dar turno
          </Button>
          <Button type="button" variant="ghost" onClick={props.onDone}>
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The free start of a booking: picked from the free times, or the one clicked. */
function FreeStart(props: {
  slot: BookingSlot | null;
  draft: BookingDraft;
  defaultDate: string;
  dispatch: Dispatch;
}) {
  return (
    <>
      {!props.slot && (
        <FreeStartPicker
          draft={props.draft}
          defaultDate={props.defaultDate}
          dispatch={props.dispatch}
        />
      )}
      <TimeTaken starts={props.draft.freshStarts} dispatch={props.dispatch} />
      <PickedSummary start={props.draft.start} />
    </>
  );
}

/** An overbooking's local date and time, and its room when outside the schedules. */
function OverbookingFields(props: {
  place: OverbookingPlace;
  rooms: { id: string; name: string }[];
  onChange: (place: OverbookingPlace) => void;
}) {
  const { place, onChange } = props;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="overbooking-date">Fecha</Label>
          <Input
            id="overbooking-date"
            type="date"
            value={place.date}
            onChange={(event) => onChange({ ...place, date: event.target.value })}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="overbooking-time">Hora</Label>
          <Input
            id="overbooking-time"
            type="time"
            value={place.time}
            onChange={(event) => onChange({ ...place, time: event.target.value })}
            required
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="overbooking-room">Consultorio</Label>
        <NativeSelect
          id="overbooking-room"
          value={place.roomId}
          onChange={(event) => onChange({ ...place, roomId: event.target.value })}
          aria-describedby="overbooking-room-hint"
        >
          <NativeSelectOption value="">El del horario del profesional</NativeSelectOption>
          {props.rooms.map((room) => (
            <NativeSelectOption key={room.id} value={room.id}>
              {room.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p id="overbooking-room-hint" className="text-muted-foreground text-xs">
          Fuera de los horarios del profesional, elegí un consultorio con lugar a esa hora.
        </p>
      </div>
    </>
  );
}

function PractitionerField(props: {
  practitioners: { id: string; displayName: string }[];
  value: string;
  dispatch: Dispatch;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="booking-practitioner">Profesional</Label>
      <NativeSelect
        id="booking-practitioner"
        value={props.value}
        onChange={(event) =>
          props.dispatch({ type: "practitionerChosen", practitionerId: event.target.value })
        }
        required
      >
        <NativeSelectOption value="" disabled>
          Elegí un profesional
        </NativeSelectOption>
        {props.practitioners.map((practitioner) => (
          <NativeSelectOption key={practitioner.id} value={practitioner.id}>
            {practitioner.displayName}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

/** The practitioner's active medical services, and the duration, which starts at the service's. */
function TypeAndDuration(props: { draft: BookingDraft; dispatch: Dispatch }) {
  if (!props.draft.practitionerId) {
    return null;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TypeField
        practitionerId={props.draft.practitionerId}
        value={props.draft.medicalService}
        dispatch={props.dispatch}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="booking-duration">Duración (minutos)</Label>
        <Input
          id="booking-duration"
          type="number"
          min={1}
          max={720}
          value={props.draft.durationMinutes ?? ""}
          disabled={!props.draft.medicalService}
          onChange={(event) =>
            props.dispatch({ type: "durationChanged", durationMinutes: Number(event.target.value) })
          }
          required
        />
      </div>
    </div>
  );
}

/** The medical service picker's empty option, once the services have loaded or before. */
function servicePlaceholder(services: readonly unknown[] | undefined): string {
  return services?.length === 0 ? "Este profesional no tiene prestaciones" : "Elegí una prestación";
}

function TypeField(props: {
  practitionerId: string;
  value: { id: string } | null;
  dispatch: Dispatch;
}) {
  const { viewer } = useRouteContext({ from: "/_app" });
  const { data } = useQuery({
    queryKey: ["medicalServices", viewer.organizationId, viewer.userId, props.practitionerId],
    queryFn: () =>
      getMedicalServices({
        data: { practitionerId: props.practitionerId, includeInactive: false },
      }),
    select: (result) => (result.ok ? result.medicalServices : []),
  });
  const options = data ?? [];

  function choose(id: string) {
    props.dispatch({
      type: "medicalServiceChosen",
      medicalService: options.find((option) => option.id === id),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="booking-medical-service">Prestación</Label>
      <NativeSelect
        id="booking-medical-service"
        value={props.value?.id ?? ""}
        onChange={(event) => choose(event.target.value)}
        required
      >
        <NativeSelectOption value="" disabled>
          {servicePlaceholder(data)}
        </NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.name} ({option.durationMinutes} min)
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

/**
 * "Nuevo turno"'s free starts for the practitioner and duration, a week from a
 * date, once the medical service is chosen.
 */
function FreeStartPicker(props: { draft: BookingDraft; defaultDate: string; dispatch: Dispatch }) {
  const [date, setDate] = useState(props.defaultDate);
  const query = freeStartsQueryOf(props.draft, date);
  if (!query) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="booking-date">Horarios libres desde</Label>
      <Input
        id="booking-date"
        type="date"
        value={date}
        onChange={(event) => event.target.value && setDate(event.target.value)}
      />
      <FreeStartsOfWeek
        query={query}
        picked={props.draft.start}
        onPick={(start) => props.dispatch({ type: "startPicked", start })}
      />
    </div>
  );
}

function PickedSummary({ start }: { start: PickedStart | null }) {
  if (!start) {
    return null;
  }
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">Turno:</span>{" "}
      <span className="font-medium">{localDateTime(start.start, start.timeZone)}</span>,{" "}
      {start.roomName}
    </p>
  );
}

/** Another booking took the time a moment before: fresh free times to pick from. */
function TimeTaken(props: { starts: AvailableStart[] | null; dispatch: Dispatch }) {
  if (!props.starts) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>Ese horario ya se ocupó</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-2">
          <p>Elegí otro horario libre:</p>
          {props.starts.length === 0 ? (
            <p>No quedan horarios libres ese día.</p>
          ) : (
            <FreeStartList
              starts={props.starts}
              picked={null}
              onPick={(start) => props.dispatch({ type: "startPicked", start })}
            />
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** The patient's other appointments that day, which the user confirms past. */
export function PatientWarnings(props: {
  warnings: BookingWarning[] | null;
  pending: boolean;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  if (!props.warnings) {
    return null;
  }
  return (
    <Alert variant="warning">
      <AlertTitle>El paciente ya tiene turno ese día</AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-2">
          <ul className="list-disc pl-5">
            {props.warnings.map((warning) => (
              <li key={+warning.start}>
                {localTime(warning.start, warning.timeZone)} a{" "}
                {localTime(warning.end, warning.timeZone)} con {warning.practitionerName}
                {warning.kind === "overlap" && ", a la misma hora"}
              </li>
            ))}
          </ul>
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={props.pending}
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
