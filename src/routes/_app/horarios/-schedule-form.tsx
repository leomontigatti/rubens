import type { FormEvent, ReactNode } from "react";
import type * as z from "zod";

import { fieldMessage } from "#/components/admin-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { scheduleState, today, weekdayLabels } from "#/lib/schedules.ts";
import type { ScheduleChange, ScheduleInput } from "#/lib/schedules.ts";
import type { getSchedules } from "#/server/schedules.functions.ts";
import type { RoomOption, Schedule } from "#/server/schedules.ts";

import { RefusalAlert, useAction } from "#/routes/_app/horarios/-shared.tsx";
import type { ActionResult, RefusalReason } from "#/routes/_app/horarios/-shared.tsx";

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

export interface FormFields {
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
export type Initial = Pick<
  Schedule,
  "roomId" | "weekdays" | "startTime" | "endTime" | "lastDate"
> & {
  date: string;
};

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

export function ScheduleForm(props: {
  practitionerId: string;
  title: string;
  description?: string;
  rooms: RoomOption[];
  initial: Initial;
  dateLabel: string;
  submitLabel: string;
  /** The server call, or the validation error that stopped it. */
  onSubmit: (fields: FormFields) => Promise<ActionResult> | z.ZodError;
}) {
  const { initial, practitionerId } = props;
  const page = useFormPage({ to: "/horarios/$practitionerId", params: { practitionerId } });
  const action = useAction();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = props.onSubmit(readForm(new FormData(event.currentTarget)));
    if (!(submitted instanceof Promise)) {
      action.setError(scheduleFieldMessage(submitted));
      return;
    }
    if (await action.save(() => submitted)) {
      page.leave();
    }
  }

  return (
    <ActionFormPage
      page={page}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      action={action}
      onSubmit={handleSubmit}
    >
      <WeekdayFields initial={initial.weekdays} />
      <div className="flex flex-wrap gap-4">
        <Field className="w-auto">
          <FieldLabel htmlFor="schedule-startTime">Inicio</FieldLabel>
          <Input
            id="schedule-startTime"
            name="startTime"
            type="time"
            defaultValue={initial.startTime}
            required
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="schedule-endTime">Fin</FieldLabel>
          <Input
            id="schedule-endTime"
            name="endTime"
            type="time"
            defaultValue={initial.endTime}
            required
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="schedule-roomId">Consultorio</FieldLabel>
        <RoomSelect id="schedule-roomId" rooms={props.rooms} initial={initial.roomId} />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Field className="w-auto">
          <FieldLabel htmlFor="schedule-date">{props.dateLabel}</FieldLabel>
          <Input id="schedule-date" name="date" type="date" defaultValue={initial.date} required />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="schedule-lastDate">Hasta (opcional)</FieldLabel>
          <Input
            id="schedule-lastDate"
            name="lastDate"
            type="date"
            defaultValue={initial.lastDate ?? ""}
          />
        </Field>
      </div>
    </ActionFormPage>
  );
}

function WeekdayFields(props: { initial: readonly number[] }) {
  return (
    <FieldSet>
      <FieldLegend variant="label">Días</FieldLegend>
      <FieldGroup data-slot="checkbox-group" className="flex-row flex-wrap">
        {Object.entries(weekdayLabels).map(([day, label]) => (
          <Field key={day} orientation="horizontal" className="w-fit">
            <Checkbox
              id={`schedule-weekday-${day}`}
              name="weekdays"
              value={day}
              defaultChecked={props.initial.includes(Number(day))}
            />
            <FieldLabel htmlFor={`schedule-weekday-${day}`}>{label}</FieldLabel>
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

type LoadedSchedules = Awaited<ReturnType<typeof getSchedules>>;

/** The schedule in what the loader answered, or why there is none to show. */
function locateSchedule(
  result: LoadedSchedules,
  scheduleId: string,
):
  | { reason: RefusalReason }
  | { schedule: Schedule; practitioner: { canEdit: boolean; active: boolean } } {
  if (!result.ok) {
    return { reason: result.reason };
  }
  const schedule = result.schedules.find((one) => one.id === scheduleId);
  return schedule
    ? { schedule, practitioner: result.practitioner }
    : { reason: "notFound" as const };
}

const mayChange = (practitioner: { canEdit: boolean; active: boolean }, ended: boolean) =>
  practitioner.canEdit && practitioner.active && !ended;

/** A change or an end of a schedule, for whoever may make one while it has not ended. */
export function EditableSchedule(props: {
  result: LoadedSchedules;
  scheduleId: string;
  children: (schedule: Schedule, state: ReturnType<typeof scheduleState>) => ReactNode;
}) {
  const found = locateSchedule(props.result, props.scheduleId);
  if ("reason" in found) {
    return <RefusalAlert reason={found.reason} />;
  }
  const state = scheduleState(found.schedule, today(found.schedule.timeZone));
  if (!mayChange(found.practitioner, state.ended)) {
    return <RefusalAlert reason="forbidden" />;
  }
  return props.children(found.schedule, state);
}
