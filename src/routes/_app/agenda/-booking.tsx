import { tz } from "@date-fns/tz";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import { useReducer, useState } from "react";
import type { FormEvent } from "react";

import { ErrorAlert } from "#/components/admin-form.tsx";
import { PatientRegistrationForm } from "#/components/patient-form.tsx";
import { patientSearchKey } from "#/components/patient-search.ts";
import { Alert, AlertDescription } from "#/components/ui/alert.tsx";
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
import { receptionNoteMaxLength } from "#/lib/appointments.ts";
import { freeStartsByDay } from "#/lib/availability.ts";
import type { AvailabilityQuery } from "#/lib/availability.ts";
import {
  bookingReducer,
  bookingRequestOf,
  freeStartsQueryOf,
  initialBookingDraft,
} from "#/lib/booking-draft.ts";
import type {
  BookingDraft,
  BookingEvent,
  BookingWarning,
  PickedStart,
} from "#/lib/booking-draft.ts";
import { patientName } from "#/lib/patients.ts";
import { getAppointmentTypes } from "#/server/appointment-types.functions.ts";
import { addAppointment } from "#/server/appointments.functions.ts";
import { getFreeTimes } from "#/server/availability.functions.ts";
import type { AvailableStart } from "#/server/availability.ts";
import { findPatients } from "#/server/patients.functions.ts";
import type { Patient } from "#/server/patients.ts";

// Booking a patient, from either entry: a free time clicked on the day view,
// which fixes the practitioner, the time and the room, or "Nuevo turno", which
// picks the practitioner, the type and then a free time for that duration.

export interface BookingSlot extends PickedStart {
  practitionerId: string;
  practitionerName: string;
}

/** The copy for every refusal booking can return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o el propio profesional pueden dar turnos.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá la duración y la nota de recepción.",
  notFound: "No encontramos el paciente, el profesional o el tipo de turno.",
  practitionerInactive: "Ese profesional está inactivo.",
  patientInactive: "Ese paciente está inactivo.",
  appointmentTypeInactive: "Ese tipo de turno está desactivado.",
  notFree: "Ese horario ya no está libre para esa duración. Elegí otro.",
};

function localTime(instant: Date, timeZone: string) {
  return format(instant, "HH:mm", { in: tz(timeZone) });
}

function localDateTime(instant: Date, timeZone: string) {
  return format(instant, "dd/MM/yyyy HH:mm", { in: tz(timeZone) });
}

export function BookingDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The free time clicked on the day view; none for "Nuevo turno". */
  slot: BookingSlot | null;
  practitioners: { id: string; displayName: string }[];
  defaultDate: string;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-svh overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo turno</DialogTitle>
          {props.slot && <DialogDescription>{props.slot.practitionerName}</DialogDescription>}
        </DialogHeader>
        {props.open && (
          <BookingForm
            slot={props.slot}
            practitioners={props.practitioners}
            defaultDate={props.defaultDate}
            onDone={() => props.onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Dispatch = (event: BookingEvent) => void;

function BookingForm(props: {
  slot: BookingSlot | null;
  practitioners: { id: string; displayName: string }[];
  defaultDate: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [draft, dispatch] = useReducer(
    bookingReducer,
    initialBookingDraft(
      props.slot,
      props.practitioners.map((practitioner) => practitioner.id),
    ),
  );
  const [pending, setPending] = useState(false);
  const request = bookingRequestOf(draft);

  async function book(confirmWarnings: boolean) {
    if (!request) {
      return;
    }
    setPending(true);
    let result: Awaited<ReturnType<typeof addAppointment>>;
    try {
      result = await addAppointment({ data: { ...request, confirmWarnings } });
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

  async function settle(
    refusal: Exclude<Awaited<ReturnType<typeof addAppointment>>, { ok: true }>,
  ) {
    if (refusal.reason === "patientWarning") {
      dispatch({ type: "warned", warnings: refusal.warnings });
    } else if (refusal.reason === "timeTaken") {
      dispatch({ type: "timeTaken", freshStarts: refusal.freeStarts });
      // The day view behind the dialog shows the time taken too.
      await router.invalidate();
    } else {
      dispatch({ type: "failed", error: refusalMessages[refusal.reason] });
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
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {!props.slot && (
          <PractitionerField
            practitioners={props.practitioners}
            value={draft.practitionerId}
            dispatch={dispatch}
          />
        )}
        <TypeAndDuration draft={draft} dispatch={dispatch} />
        {!props.slot && (
          <FreeStartPicker draft={draft} defaultDate={props.defaultDate} dispatch={dispatch} />
        )}
        <TimeTaken starts={draft.freshStarts} dispatch={dispatch} />
        <PickedSummary start={draft.start} />
        <NoteField value={draft.receptionNote} dispatch={dispatch} />
        <PatientWarnings
          warnings={draft.warnings}
          pending={pending}
          onConfirm={() => void book(true)}
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

/** The practitioner's active types, and the duration, which starts at the type's. */
function TypeAndDuration(props: { draft: BookingDraft; dispatch: Dispatch }) {
  if (!props.draft.practitionerId) {
    return null;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TypeField
        practitionerId={props.draft.practitionerId}
        value={props.draft.type}
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
          disabled={!props.draft.type}
          onChange={(event) =>
            props.dispatch({ type: "durationChanged", durationMinutes: Number(event.target.value) })
          }
          required
        />
      </div>
    </div>
  );
}

/** The type picker's empty option, once the types have loaded or before. */
function typePlaceholder(types: readonly unknown[] | undefined): string {
  return types?.length === 0 ? "Este profesional no tiene tipos de turno" : "Elegí un tipo";
}

function TypeField(props: {
  practitionerId: string;
  value: { id: string } | null;
  dispatch: Dispatch;
}) {
  const { viewer } = useRouteContext({ from: "/_app" });
  const { data } = useQuery({
    queryKey: ["appointmentTypes", viewer.organizationId, viewer.userId, props.practitionerId],
    queryFn: () =>
      getAppointmentTypes({
        data: { practitionerId: props.practitionerId, includeInactive: false },
      }),
    select: (result) => (result.ok ? result.appointmentTypes : []),
  });
  const options = data ?? [];

  function choose(id: string) {
    props.dispatch({
      type: "typeChosen",
      appointmentType: options.find((option) => option.id === id),
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="booking-type">Tipo de turno</Label>
      <NativeSelect
        id="booking-type"
        value={props.value?.id ?? ""}
        onChange={(event) => choose(event.target.value)}
        required
      >
        <NativeSelectOption value="" disabled>
          {typePlaceholder(data)}
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

function NoteField(props: { value: string; dispatch: Dispatch }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="booking-note">Nota de recepción (opcional)</Label>
      <Input
        id="booking-note"
        value={props.value}
        maxLength={receptionNoteMaxLength}
        placeholder="Por ejemplo: trae radiografías"
        onChange={(event) =>
          props.dispatch({ type: "noteChanged", receptionNote: event.target.value })
        }
        aria-describedby="booking-note-hint"
      />
      <p id="booking-note-hint" className="text-muted-foreground text-xs">
        La información clínica va en la historia clínica, no acá.
      </p>
    </div>
  );
}

/** Finds the patient with the search box, or registers one on the spot. */
function PatientPicker(props: { onChange: (patientId: string | null) => void }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [registering, setRegistering] = useState(false);

  function choose(chosen: Patient | null) {
    setPatient(chosen);
    setRegistering(false);
    props.onChange(chosen?.id ?? null);
  }

  if (patient) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm">
          <span className="text-muted-foreground">Paciente:</span>{" "}
          <span className="font-medium">{patientName(patient)}</span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => choose(null)}>
          Cambiar
        </Button>
      </div>
    );
  }
  if (registering) {
    return (
      <PatientRegistrationForm
        onRegistered={choose}
        onUseExisting={choose}
        onCancel={() => setRegistering(false)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <PatientSearch onChoose={choose} />
      <div>
        <Button type="button" variant="link" onClick={() => setRegistering(true)}>
          Registrar paciente nuevo
        </Button>
      </div>
    </div>
  );
}

function PatientSearch(props: { onChoose: (patient: Patient) => void }) {
  const { viewer } = useRouteContext({ from: "/_app" });
  const [query, setQuery] = useState("");
  const search = { query, includeInactive: false };
  const { data } = useQuery({
    queryKey: patientSearchKey(viewer, search),
    queryFn: () => findPatients({ data: search }),
    enabled: query.trim() !== "",
    placeholderData: keepPreviousData,
    select: (result) => (result.ok ? result.patients : []),
  });

  return (
    <>
      <Label htmlFor="booking-patient">Paciente</Label>
      <Input
        id="booking-patient"
        type="search"
        placeholder="Buscar por nombre, documento o teléfono"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() && <PatientResults patients={data} onChoose={props.onChoose} />}
    </>
  );
}

function PatientResults(props: {
  patients: Patient[] | undefined;
  onChoose: (patient: Patient) => void;
}) {
  if (!props.patients) {
    return null;
  }
  if (props.patients.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Ningún paciente coincide con la búsqueda.</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {props.patients.map((patient) => (
        <li key={patient.id}>
          <Button type="button" variant="ghost" size="sm" onClick={() => props.onChoose(patient)}>
            {patientName(patient)}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Nuevo turno"'s free starts for the practitioner and duration, a week from a
 * date, once the type is chosen.
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
      <FreeStartsOfWeek query={query} picked={props.draft.start} dispatch={props.dispatch} />
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

function FreeStartsOfWeek(props: {
  query: AvailabilityQuery;
  picked: PickedStart | null;
  dispatch: Dispatch;
}) {
  const { viewer } = useRouteContext({ from: "/_app" });
  const { data } = useQuery({
    queryKey: ["freeTimes", viewer.organizationId, viewer.userId, props.query],
    queryFn: () => getFreeTimes({ data: props.query }),
    placeholderData: keepPreviousData,
  });

  if (!data) {
    return null;
  }
  if (!data.ok) {
    return <ErrorAlert message={refusalMessages.notFound} />;
  }
  if (data.freeStarts.length === 0) {
    return <p className="text-muted-foreground text-sm">No hay horarios libres esa semana.</p>;
  }
  return (
    <FreeStartList
      starts={data.freeStarts}
      picked={props.picked}
      onPick={(start) => props.dispatch({ type: "startPicked", start })}
    />
  );
}

function FreeStartList(props: {
  starts: AvailableStart[];
  picked: PickedStart | null;
  onPick: (start: PickedStart) => void;
}) {
  return (
    <div className="flex max-h-60 flex-col gap-3 overflow-y-auto">
      {freeStartsByDay(props.starts).map((day) => (
        <div key={day.date} className="flex flex-col gap-1">
          <p className="text-sm font-medium">{day.label}</p>
          <div className="flex flex-wrap gap-1">
            {day.starts.map((free) => (
              <Button
                key={+free.start}
                type="button"
                size="xs"
                variant={+free.start === +(props.picked?.start ?? 0) ? "default" : "outline"}
                title={`${free.officeName}, ${free.roomName}`}
                onClick={() => props.onPick(free)}
              >
                {free.time}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Another booking took the time a moment before: fresh free times to pick from. */
function TimeTaken(props: { starts: AvailableStart[] | null; dispatch: Dispatch }) {
  if (!props.starts) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertDescription>
        <div className="flex flex-col gap-2">
          <p>Ese horario ya se ocupó. Elegí otro horario libre:</p>
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
function PatientWarnings(props: {
  warnings: BookingWarning[] | null;
  pending: boolean;
  onConfirm: () => void;
}) {
  if (!props.warnings) {
    return null;
  }
  return (
    <Alert>
      <AlertDescription>
        <div className="flex flex-col gap-2">
          <p>El paciente ya tiene turno ese día:</p>
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
              Dar turno igual
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
