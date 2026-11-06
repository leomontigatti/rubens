import { tz } from "@date-fns/tz";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import type { NavigateOptions } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-form";
import { format } from "date-fns";
import { useState } from "react";

import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import type { FieldProblem } from "#/components/form-problems.ts";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import { receptionNoteMaxLength } from "#/lib/appointments.ts";
import { defaultTimeZone } from "#/lib/offices.ts";
import {
  bookingFieldNames,
  bookingRequestOf,
  freeStartsQueryOf,
  initialBookingValues,
  overbookingFieldNames,
  overbookingRequestOf,
} from "#/lib/booking-draft.ts";
import type {
  BookingStart,
  BookingValues,
  BookingWarning,
  OfferedStart,
  PickedStart,
} from "#/lib/booking-draft.ts";
import { getMedicalServices } from "#/server/medical-services.functions.ts";
import type { RoomOccupant } from "#/organization/appointment-placement.ts";
import { addAppointment, addOverbooking } from "#/server/appointments.functions.ts";
import { FreeStartList, FreeStartsOfWeek, StartGroup } from "#/routes/_app/agenda/-free-starts.tsx";
import { PatientPicker } from "#/routes/_app/agenda/-patient-picker.tsx";

// Booking a patient on a page of its own, from either entry: a free cell
// clicked on the calendar, which fixes the time and the room, and the
// practitioner unless several are free there, or "Nuevo turno", which picks
// the practitioner, the medical service and then a free time for that
// duration. An overbooking takes a typed date and time instead, and a room
// when it falls outside the practitioner's schedules.

/** The copy for every refusal booking can return. */
const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o el propio profesional pueden dar turnos.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
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

type RefusalReason = keyof typeof refusalMessages;

/** The refusals about one field, by the form's name for it; the start's is a booking's. */
const refusalFields: Partial<Record<RefusalReason, string>> = {
  patientInactive: "patient",
  practitionerInactive: "practitionerId",
  medicalServiceInactive: "medicalServiceId",
  notFree: "start",
  timeOff: "start",
  closed: "start",
  roomRequired: "roomId",
  roomInactive: "roomId",
};

/** What the form's check says of each field it refuses. */
const fieldMessages = {
  patientId: "Elegí un paciente.",
  practitionerId: "Elegí un profesional.",
  medicalServiceId: "Elegí una prestación.",
  start: "Elegí un horario libre.",
  receptionNote: `La nota de recepción puede tener hasta ${receptionNoteMaxLength} caracteres.`,
  roomId: "Elegí un consultorio.",
};

/** An overbooking's start is typed, in its date and time. */
const overbookingMessages = { ...fieldMessages, start: "Ingresá la fecha y la hora." };

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

type BookingRefusal =
  | Exclude<Awaited<ReturnType<typeof addAppointment>>, { ok: true }>
  | Exclude<Awaited<ReturnType<typeof addOverbooking>>, { ok: true }>;

/** What the last attempt answered: warnings to confirm past, the free times left, or a refusal. */
interface Answer {
  warnings: BookingWarning[] | null;
  freshStarts: OfferedStart[] | null;
  refusal: FieldProblem | null;
}

const noAnswer: Answer = { warnings: null, freshStarts: null, refusal: null };

/** What a refusal answers; a start no longer free brings the free times its day has left. */
function answerOf(refusal: BookingRefusal, office: OverbookingOffice | null): Answer {
  if (refusal.reason === "patientWarning") {
    return { ...noAnswer, warnings: refusal.warnings };
  }
  return {
    ...noAnswer,
    freshStarts: refusal.reason === "notFree" ? refusal.freeStarts : null,
    refusal: refusalProblem(refusal, office),
  };
}

type PlainRefusal = Exclude<BookingRefusal, { reason: "patientWarning" }>;

/** A refusal under its field; an overbooking's room is the field a full room is about. */
function refusalProblem(refusal: PlainRefusal, office: OverbookingOffice | null): FieldProblem {
  if (refusal.reason === "roomFull") {
    return roomFullProblem(refusal.occupants, office);
  }
  return { field: refusalField(refusal.reason, office), message: refusalMessages[refusal.reason] };
}

function roomFullProblem(
  occupants: RoomOccupant[],
  office: OverbookingOffice | null,
): FieldProblem {
  // A booking's refusals hold no zone; its office is the default one.
  const timeZone = office?.timeZone ?? defaultTimeZone;
  return { field: office ? "roomId" : "start", message: roomFullMessage(occupants, timeZone) };
}

/** An overbooking's start is typed in its time. */
function refusalField(reason: RefusalReason, office: OverbookingOffice | null): string {
  const field = refusalFields[reason] ?? "";
  return office && field === "start" ? "time" : field;
}

/** What a duration's check says: none typed, or not a valid one. */
export function durationMessage(typed: string): string {
  return typed.trim() === ""
    ? "Ingresá la duración."
    : "La duración tiene que ser un número entero de minutos, entre 1 y 720.";
}

/** What the form books, or what its check refused, under each field. */
function requestOf(values: BookingValues, office: OverbookingOffice | null) {
  const duration = { durationMinutes: durationMessage(values.durationMinutes) };
  if (office) {
    const parsed = overbookingRequestOf(values, office.timeZone);
    const messages = messageIn({ ...overbookingMessages, ...duration });
    return parsed.success
      ? { overbooking: true as const, data: parsed.data }
      : fieldProblems(parsed.error.issues, messages, overbookingFieldNames);
  }
  const parsed = bookingRequestOf(values);
  return parsed.success
    ? { overbooking: false as const, data: parsed.data }
    : fieldProblems(
        parsed.error.issues,
        messageIn({ ...fieldMessages, ...duration }),
        bookingFieldNames,
      );
}

type BookingRequest = Exclude<ReturnType<typeof requestOf>, FieldProblem[]>;

async function send(request: BookingRequest, confirmWarnings: boolean) {
  return request.overbooking
    ? addOverbooking({ data: { ...request.data, confirmWarnings } })
    : addAppointment({ data: { ...request.data, confirmWarnings } });
}

export interface BookingPageProps {
  /** Where `Volver` goes when the page was opened from a link. */
  back: NavigateOptions;
  /** The clicked free cell, or the appointment an overbooking goes over. */
  from: BookingStart | null;
  /** Whom the form books for; it asks only when there are several. */
  practitioners: { id: string; displayName: string }[];
  defaultDate: string;
  /** Set for an overbooking. */
  overbooking: OverbookingOffice | null;
}

function useBookingForm(props: BookingPageProps) {
  const page = useFormPage(props.back);
  const router = useRouter();
  const [answer, setAnswer] = useState<Answer>(noAnswer);
  const [pending, setPending] = useState(false);

  async function book(values: BookingValues, confirmWarnings: boolean) {
    page.clearProblems();
    setAnswer(noAnswer);
    const request = requestOf(values, props.overbooking);
    if (Array.isArray(request)) {
      page.showProblems(request);
      return;
    }
    setPending(true);
    const result = await serverAnswer("booking", shownPath(router), () =>
      send(request, confirmWarnings),
    );
    setPending(false);
    if (!result) {
      return;
    }
    if (result.ok) {
      page.leave();
      return;
    }
    if (result.reason === "notFree") {
      form.setFieldValue("start", null);
    }
    setAnswer(answerOf(result, props.overbooking));
  }

  const form = useAppForm({
    defaultValues: initialBookingValues(
      props.from,
      props.practitioners.map((practitioner) => practitioner.id),
      props.defaultDate,
    ),
    // A warning confirmed after a change would book what it never warned about,
    // and the times left were for what was asked then; picking one of them keeps
    // the list, the only picker on a page opened from a cell. A refusal stays
    // until the next submit.
    listeners: {
      onChange: ({ fieldApi }) =>
        setAnswer((last) => ({
          ...noAnswer,
          refusal: last.refusal,
          freshStarts: fieldApi.name === "start" ? last.freshStarts : null,
        })),
    },
    onSubmit: ({ value }) => book(value, false),
  });

  return {
    page,
    form,
    answer,
    refusals: answer.refusal ? [answer.refusal] : undefined,
    clearAnswer: () => setAnswer(noAnswer),
    pending,
    book,
  };
}

type BookingForm = ReturnType<typeof useBookingForm>["form"];

export function BookingPage(props: BookingPageProps) {
  const { page, form, answer, refusals, clearAnswer, pending, book } = useBookingForm(props);
  // Asks among several, or none to pick from; one is named under the title.
  const ask = props.practitioners.length !== 1;

  return (
    <FormPage
      page={page}
      form={form}
      title={props.overbooking ? "Sobreturno" : "Nuevo turno"}
      description={ask ? undefined : props.practitioners[0]!.displayName}
      submitLabel="Dar turno"
      pending={pending}
      refusals={refusals}
      onClear={clearAnswer}
      lead={
        <form.AppField name="patient">{(field) => <PatientPicker field={field} />}</form.AppField>
      }
    >
      <WhoAndWhen form={form} props={props} ask={ask} freshStarts={answer.freshStarts} />
      <form.AppField name="receptionNote">
        {(field) => (
          <field.TextField
            label="Nota de recepción (opcional)"
            hint="La información clínica va en la historia clínica, no acá."
            placeholder="Por ejemplo: trae radiografías"
            maxLength={receptionNoteMaxLength}
          />
        )}
      </form.AppField>
      <PatientWarnings
        warnings={answer.warnings}
        pending={pending}
        onConfirm={() => void book(form.state.values, true)}
        confirmLabel="Dar turno igual"
      />
    </FormPage>
  );
}

/** The practitioner when there is a choice, the medical service and duration, and the start. */
function WhoAndWhen(params: {
  form: BookingForm;
  props: BookingPageProps;
  ask: boolean;
  freshStarts: OfferedStart[] | null;
}) {
  const { form, props } = params;
  const fixed = props.from !== null;
  return (
    <>
      {params.ask && (
        <PractitionerField form={form} practitioners={props.practitioners} fixed={fixed} />
      )}
      <TypeAndDuration form={form} />
      {props.overbooking ? (
        <OverbookingFields form={form} rooms={props.overbooking.rooms} />
      ) : (
        <StartField form={form} fixed={fixed} freshStarts={params.freshStarts} />
      )}
    </>
  );
}

/** Whom to book for, among several; a new one drops the medical service, and a start not fixed. */
function PractitionerField(props: {
  form: BookingForm;
  practitioners: { id: string; displayName: string }[];
  fixed: boolean;
}) {
  const { form } = props;
  return (
    <form.AppField
      name="practitionerId"
      listeners={{
        onChange: () => {
          form.setFieldValue("medicalServiceId", "");
          form.setFieldValue("durationMinutes", "");
          if (!props.fixed) {
            form.setFieldValue("start", null);
          }
        },
      }}
    >
      {(field) => (
        <field.SelectField label="Profesional" required>
          <NativeSelectOption value="" disabled>
            Elegí un profesional
          </NativeSelectOption>
          {props.practitioners.map((practitioner) => (
            <NativeSelectOption key={practitioner.id} value={practitioner.id}>
              {practitioner.displayName}
            </NativeSelectOption>
          ))}
        </field.SelectField>
      )}
    </form.AppField>
  );
}

/** The medical service picker's empty option, once the services have loaded or before. */
function servicePlaceholder(services: readonly unknown[] | undefined): string {
  return services?.length === 0 ? "Este profesional no tiene prestaciones" : "Elegí una prestación";
}

/**
 * The practitioner's active medical services, and the duration, which starts
 * at the service's, once a practitioner is chosen.
 */
function TypeAndDuration({ form }: { form: BookingForm }) {
  const { viewer } = useRouteContext({ from: "/_app" });
  const practitionerId = useStore(form.store, (state) => state.values.practitionerId);
  const { data } = useQuery({
    queryKey: ["medicalServices", viewer.organizationId, viewer.userId, practitionerId],
    queryFn: () => getMedicalServices({ data: { practitionerId, includeInactive: false } }),
    select: (result) => (result.ok ? result.medicalServices : []),
    enabled: practitionerId !== "",
  });
  if (!practitionerId) {
    return null;
  }
  const options = data ?? [];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <form.AppField
        name="medicalServiceId"
        listeners={{
          onChange: ({ value }) => {
            const chosen = options.find((option) => option.id === value);
            form.setFieldValue("durationMinutes", chosen ? String(chosen.durationMinutes) : "");
          },
        }}
      >
        {(field) => (
          <field.SelectField label="Prestación" required>
            <NativeSelectOption value="" disabled>
              {servicePlaceholder(data)}
            </NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.name} ({option.durationMinutes} min)
              </NativeSelectOption>
            ))}
          </field.SelectField>
        )}
      </form.AppField>
      <form.AppField name="durationMinutes">
        {(field) => (
          <field.TextField label="Duración (minutos)" type="number" min={1} max={720} required />
        )}
      </form.AppField>
    </div>
  );
}

/**
 * A booking's start: the one clicked, or picked from the practitioner's free
 * times for the duration, a week from a date.
 */
function StartField(props: {
  form: BookingForm;
  fixed: boolean;
  /** The free times left that day, after the one picked stopped being free. */
  freshStarts: OfferedStart[] | null;
}) {
  const { form, fixed } = props;
  const query = useStore(form.store, (state) => freeStartsQueryOf(state.values));
  return (
    <form.Field name="start">
      {(field) => (
        <StartGroup>
          {!fixed && (
            <form.AppField name="freeFrom">
              {(from) => <from.TextField label="Horarios libres desde" type="date" inline />}
            </form.AppField>
          )}
          {!fixed && query && (
            <FreeStartsOfWeek
              query={query}
              picked={field.state.value}
              onPick={field.handleChange}
            />
          )}
          <FreshStarts
            starts={props.freshStarts}
            picked={field.state.value}
            onPick={field.handleChange}
          />
          <PickedSummary start={field.state.value} />
        </StartGroup>
      )}
    </form.Field>
  );
}

/** An overbooking's local date and time, and its room when outside the schedules. */
function OverbookingFields(props: { form: BookingForm; rooms: { id: string; name: string }[] }) {
  const { form } = props;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField name="date">
          {(field) => <field.TextField label="Fecha" type="date" required />}
        </form.AppField>
        <form.AppField name="time">
          {(field) => <field.TextField label="Hora" type="time" required />}
        </form.AppField>
      </div>
      <form.AppField name="roomId">
        {(field) => (
          <field.SelectField
            label="Consultorio"
            hint="Fuera de los horarios del profesional, elegí un consultorio con lugar a esa hora."
          >
            <NativeSelectOption value="">El del horario del profesional</NativeSelectOption>
            {props.rooms.map((room) => (
              <NativeSelectOption key={room.id} value={room.id}>
                {room.name}
              </NativeSelectOption>
            ))}
          </field.SelectField>
        )}
      </form.AppField>
    </>
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

/** The free times left that day, once the one picked stopped being free. */
function FreshStarts(props: {
  starts: OfferedStart[] | null;
  picked: PickedStart | null;
  onPick: (start: PickedStart) => void;
}) {
  if (!props.starts) {
    return null;
  }
  if (props.starts.length === 0) {
    return <p className="text-muted-foreground text-sm">No quedan horarios libres ese día.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">Horarios libres que quedan ese día:</p>
      <FreeStartList starts={props.starts} picked={props.picked} onPick={props.onPick} />
    </div>
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
