import { ClockIcon } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type * as z from "zod";

import { EmptyState } from "#/components/empty-state.tsx";
import { ErrorAlert, FormActions, fieldMessage } from "#/components/admin-form.tsx";
import { CreateSheet, FormSheet } from "#/components/form-sheet.tsx";
import { ConfirmDialog } from "#/components/confirm-dialog.tsx";
import { PageHeader } from "#/components/page-header.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "#/components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  scheduleChangeSchema,
  scheduleEndSchema,
  scheduleInputSchema,
  scheduleState,
  today,
  validityLabel,
  weekdayLabels,
  weekdaysLabel,
} from "#/lib/schedules.ts";
import type { ScheduleChange, ScheduleInput } from "#/lib/schedules.ts";
import {
  addSchedule,
  editSchedule,
  finishSchedule,
  getSchedules,
  removeSchedule,
} from "#/server/schedules.functions.ts";
import type { RoomOption, Schedule } from "#/server/schedules.ts";

import { RefusalAlert, useAction } from "#/routes/_app/horarios/-shared.tsx";
import type { ActionResult } from "#/routes/_app/horarios/-shared.tsx";

export const Route = createFileRoute("/_app/horarios/$practitionerId")({
  loader: ({ params }) => getSchedules({ data: { practitionerId: params.practitionerId } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.ok
          ? `Horarios de ${loaderData.practitioner.displayName} · Rubens`
          : "Horarios · Rubens",
      },
    ],
  }),
  component: PractitionerSchedules,
});

type FieldName = keyof ScheduleInput | keyof ScheduleChange;

const fieldMessages: Record<FieldName, string> = {
  practitionerId: "No encontramos ese profesional.",
  scheduleId: "No encontramos ese horario.",
  roomId: "Elegí un consultorio.",
  weekdays: "Elegí al menos un día.",
  startTime: "Ingresá la hora de inicio.",
  endTime: "Ingresá la hora de fin.",
  firstDate: "Ingresá la fecha de inicio.",
  from: "Ingresá desde qué fecha rige el cambio.",
  lastDate: "La fecha de fin no es válida.",
};

/** The copy for the ranges `checkRanges` (src/lib/schedules.ts) refuses, by its issue's message. */
const rangeMessages: Record<string, string> = {
  endBeforeStart: "La hora de fin tiene que ser posterior a la de inicio.",
  lastBeforeFirst: "La fecha de fin no puede ser anterior a la de inicio.",
};

/** The message for the first problem `error` names. */
function scheduleFieldMessage(error: z.ZodError): string {
  return rangeMessages[error.issues[0]!.message] ?? fieldMessage(fieldMessages, error);
}

function PractitionerSchedules() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  const { practitioner, schedules, rooms } = result;
  const canEdit = practitioner.canEdit && practitioner.active;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader back={{ to: "/horarios", label: "Horarios" }} title={practitioner.displayName} />
      <CreateSheet canCreate={canEdit} label="Nuevo horario">
        {(close) => (
          <ScheduleForm
            idPrefix="new"
            rooms={rooms}
            initial={emptyInitial}
            dateLabel="Desde"
            submitLabel="Crear horario"
            onCancel={close}
            onDone={close}
            onSubmit={(fields) => {
              const input = scheduleInputSchema.safeParse({
                practitionerId: practitioner.id,
                firstDate: fields.date,
                ...fields.rest,
              });
              return input.success ? addSchedule({ data: input.data }) : input.error;
            }}
          />
        )}
      </CreateSheet>
      {schedules.length === 0 ? (
        <NoSchedules canEdit={canEdit} rooms={rooms} />
      ) : (
        <ul className="flex flex-col gap-3">
          {schedules.map((schedule) => (
            <ScheduleItem key={schedule.id} schedule={schedule} rooms={rooms} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** A schedule needs an active room, so with none that comes first. */
function NoSchedules(props: { canEdit: boolean; rooms: RoomOption[] }) {
  return (
    <EmptyState
      icon={ClockIcon}
      title="Todavía no tiene horarios"
      description={
        props.rooms.length > 0
          ? "Agregá el primero con Nuevo horario."
          : "Primero hace falta un consultorio activo en Sedes."
      }
      canAct={props.canEdit}
    />
  );
}

type Mode = "view" | "change" | "end";

function ScheduleItem(props: { schedule: Schedule; rooms: RoomOption[]; canEdit: boolean }) {
  const { schedule } = props;
  const [mode, setMode] = useState<Mode>("view");
  const state = scheduleState(schedule, today(schedule.timeZone));
  const editable = props.canEdit && !state.ended;
  const close = () => setMode("view");

  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <ScheduleSummary schedule={schedule} ended={state.ended}>
            {editable && (
              <ScheduleActions schedule={schedule} deletable={!state.started} onMode={setMode} />
            )}
          </ScheduleSummary>
        </CardContent>
      </Card>
      <FormSheet open={mode === "change"} onClose={close} title="Cambiar horario">
        <ChangeForm
          schedule={schedule}
          rooms={props.rooms}
          from={state.changeFrom}
          onDone={close}
        />
      </FormSheet>
      <FormSheet open={mode === "end"} onClose={close} title="Terminar horario">
        <EndForm schedule={schedule} initial={state.endDefault} onDone={close} />
      </FormSheet>
    </li>
  );
}

function ScheduleSummary(props: { schedule: Schedule; ended: boolean; children: ReactNode }) {
  const { schedule } = props;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-medium">
          {weekdaysLabel(schedule.weekdays)} · {schedule.startTime} a {schedule.endTime}
        </span>
        <span className="text-muted-foreground text-sm">
          {schedule.roomName} · {schedule.officeName}
        </span>
        <span className="text-muted-foreground text-sm">
          {validityLabel(schedule)}
          {props.ended && " · Terminado"}
        </span>
      </div>
      {props.children}
    </div>
  );
}

/** Change, end and, before the first date, delete. */
function ScheduleActions(props: {
  schedule: Schedule;
  deletable: boolean;
  onMode: (mode: Mode) => void;
}) {
  const remove = useAction();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => props.onMode("change")}>
          Cambiar
        </Button>
        <Button variant="outline" size="sm" onClick={() => props.onMode("end")}>
          Terminar
        </Button>
        {props.deletable && (
          <Button
            variant="outline"
            size="sm"
            disabled={remove.pending}
            onClick={() => setConfirming(true)}
          >
            Eliminar
          </Button>
        )}
      </div>
      <ErrorAlert message={remove.error} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="¿Eliminar este horario?"
        description="El horario se borra y no se puede recuperar. Si tiene turnos, salvo sobreturnos, pasan a Turnos a reprogramar."
        confirmLabel="Eliminar"
        onConfirm={() =>
          void remove.run(() => removeSchedule({ data: { scheduleId: props.schedule.id } }))
        }
      />
    </div>
  );
}

function ChangeForm(props: {
  schedule: Schedule;
  rooms: RoomOption[];
  from: string;
  onDone: () => void;
}) {
  const { schedule } = props;
  return (
    <ScheduleForm
      idPrefix={schedule.id}
      rooms={props.rooms}
      initial={{ ...schedule, date: props.from }}
      dateLabel="El cambio rige desde"
      submitLabel="Guardar cambio"
      onCancel={props.onDone}
      onDone={props.onDone}
      onSubmit={(fields) => {
        const input = scheduleChangeSchema.safeParse({
          scheduleId: schedule.id,
          from: fields.date,
          ...fields.rest,
        });
        return input.success ? editSchedule({ data: input.data }) : input.error;
      }}
    />
  );
}

interface FormFields {
  date: string;
  rest: {
    roomId: string;
    weekdays: number[];
    startTime: string;
    endTime: string;
    lastDate: string | null;
  };
}

/** What a form starts from: a schedule's fields and the date it applies from. */
type Initial = Pick<Schedule, "roomId" | "weekdays" | "startTime" | "endTime" | "lastDate"> & {
  date: string;
};

const emptyInitial: Initial = {
  roomId: "",
  weekdays: [],
  startTime: "",
  endTime: "",
  lastDate: null,
  date: "",
};

interface ScheduleFormProps {
  idPrefix: string;
  rooms: RoomOption[];
  initial: Initial;
  dateLabel: string;
  submitLabel: string;
  onCancel: () => void;
  onDone: () => void;
  /** The server call, or the validation error that stopped it. */
  onSubmit: (fields: FormFields) => Promise<ActionResult> | z.ZodError;
}

function readForm(form: FormData): FormFields {
  const lastDate = form.get("lastDate") as string;
  return {
    date: form.get("date") as string,
    rest: {
      roomId: form.get("roomId") as string,
      weekdays: form.getAll("weekdays").map(Number),
      startTime: form.get("startTime") as string,
      endTime: form.get("endTime") as string,
      lastDate: lastDate === "" ? null : lastDate,
    },
  };
}

function ScheduleForm(props: ScheduleFormProps) {
  const action = useAction();
  const { idPrefix, initial } = props;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = props.onSubmit(readForm(new FormData(event.currentTarget)));
    if (!(submitted instanceof Promise)) {
      action.setError(scheduleFieldMessage(submitted));
      return;
    }
    if (await action.run(() => submitted)) {
      props.onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      <WeekdayFields idPrefix={idPrefix} initial={initial.weekdays} />
      <div className="flex flex-wrap gap-4">
        <Field className="w-auto">
          <FieldLabel htmlFor={`${idPrefix}-startTime`}>Inicio</FieldLabel>
          <Input
            id={`${idPrefix}-startTime`}
            name="startTime"
            type="time"
            defaultValue={initial.startTime}
            required
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor={`${idPrefix}-endTime`}>Fin</FieldLabel>
          <Input
            id={`${idPrefix}-endTime`}
            name="endTime"
            type="time"
            defaultValue={initial.endTime}
            required
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-roomId`}>Consultorio</FieldLabel>
        <RoomSelect id={`${idPrefix}-roomId`} rooms={props.rooms} initial={initial.roomId} />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field className="w-auto">
          <FieldLabel htmlFor={`${idPrefix}-date`}>{props.dateLabel}</FieldLabel>
          <Input
            id={`${idPrefix}-date`}
            name="date"
            type="date"
            defaultValue={initial.date}
            required
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor={`${idPrefix}-lastDate`}>Hasta (opcional)</FieldLabel>
          <Input
            id={`${idPrefix}-lastDate`}
            name="lastDate"
            type="date"
            defaultValue={initial.lastDate ?? ""}
          />
        </Field>
      </div>
      <FormActions
        pending={action.pending}
        submitLabel={props.submitLabel}
        onCancel={props.onCancel}
      />
    </form>
  );
}

function WeekdayFields(props: { idPrefix: string; initial: readonly number[] }) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Días</FieldLegend>
      <FieldGroup data-slot="checkbox-group" className="flex-row flex-wrap">
        {Object.entries(weekdayLabels).map(([day, label]) => (
          <Field key={day} orientation="horizontal" className="w-fit">
            <Checkbox
              id={`${props.idPrefix}-weekday-${day}`}
              name="weekdays"
              value={day}
              defaultChecked={props.initial.includes(Number(day))}
            />
            <FieldLabel htmlFor={`${props.idPrefix}-weekday-${day}`}>{label}</FieldLabel>
          </Field>
        ))}
      </FieldGroup>
    </FieldSet>
  );
}

function RoomSelect(props: { id: string; rooms: RoomOption[]; initial: string }) {
  return (
    <NativeSelect id={props.id} name="roomId" defaultValue={props.initial} required>
      <NativeSelectOption value="" disabled>
        Elegí un consultorio
      </NativeSelectOption>
      {props.rooms.map((room) => (
        <NativeSelectOption key={room.id} value={room.id}>
          {room.name} · {room.officeName}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function EndForm(props: { schedule: Schedule; initial: string; onDone: () => void }) {
  const action = useAction();
  const id = `${props.schedule.id}-end`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = scheduleEndSchema.safeParse({
      scheduleId: props.schedule.id,
      lastDate: new FormData(event.currentTarget).get("lastDate"),
    });
    if (!input.success) {
      action.setError("Ingresá el último día del horario.");
      return;
    }
    if (await action.run(() => finishSchedule({ data: input.data }))) {
      props.onDone();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      <ErrorAlert message={action.error} />
      <Field>
        <FieldLabel htmlFor={id}>Último día</FieldLabel>
        <Input id={id} name="lastDate" type="date" defaultValue={props.initial} required />
      </Field>
      <FormActions
        pending={action.pending}
        submitLabel="Terminar horario"
        onCancel={props.onDone}
      />
    </form>
  );
}
