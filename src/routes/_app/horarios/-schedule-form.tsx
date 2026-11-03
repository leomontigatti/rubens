import type { ReactNode } from "react";
import type * as z from "zod";

import { pickedIn, useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
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

const scheduleMessage = (issue: z.core.$ZodIssue) =>
  rangeMessages[issue.message] ?? messageIn(fieldMessages)(issue);

/** The form holds the start and the change's date in one field. */
const scheduleFieldNames = { firstDate: "date", from: "date" };

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

function readValues(values: ScheduleValues): FormFields {
  return {
    date: values.date,
    rest: {
      roomId: values.roomId,
      weekdays: values.weekdays.map(Number),
      startTime: values.startTime,
      endTime: values.endTime,
      lastDate: values.lastDate === "" ? null : values.lastDate,
    },
  };
}

const weekdayOptions = Object.entries(weekdayLabels).map(([value, label]) => ({ value, label }));

type ScheduleValues = Omit<Initial, "weekdays" | "lastDate"> & {
  weekdays: string[];
  lastDate: string;
};

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
  const defaultValues: ScheduleValues = {
    roomId: initial.roomId,
    weekdays: pickedIn(weekdayOptions, initial.weekdays.map(String)),
    startTime: initial.startTime,
    endTime: initial.endTime,
    date: initial.date,
    lastDate: initial.lastDate ?? "",
  };
  const form = useAppForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      const submitted = props.onSubmit(readValues(value));
      if (!(submitted instanceof Promise)) {
        page.showProblems(fieldProblems(submitted.issues, scheduleMessage, scheduleFieldNames));
        return;
      }
      if (await action.save(() => submitted)) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      action={action}
    >
      <form.AppField name="weekdays">
        {(field) => <field.CheckboxGroupField legend="Días" options={weekdayOptions} row />}
      </form.AppField>
      <div className="flex flex-wrap gap-4">
        <form.AppField name="startTime">
          {(field) => <field.TextField label="Inicio" type="time" inline required />}
        </form.AppField>
        <form.AppField name="endTime">
          {(field) => <field.TextField label="Fin" type="time" inline required />}
        </form.AppField>
      </div>
      <form.AppField name="roomId">
        {(field) => (
          <field.SelectField label="Consultorio" required>
            <NativeSelectOption value="" disabled>
              Elegí un consultorio
            </NativeSelectOption>
            {props.rooms.map((room) => (
              <NativeSelectOption key={room.id} value={room.id}>
                {room.name} · {room.officeName}
              </NativeSelectOption>
            ))}
          </field.SelectField>
        )}
      </form.AppField>
      <div className="flex flex-wrap gap-4">
        <form.AppField name="date">
          {(field) => <field.TextField label={props.dateLabel} type="date" inline required />}
        </form.AppField>
        <form.AppField name="lastDate">
          {(field) => <field.TextField label="Hasta (opcional)" type="date" inline />}
        </form.AppField>
      </div>
    </ActionFormPage>
  );
}

/**
 * The rooms a schedule's form offers: the active ones, and the schedule's own
 * when it was deactivated since, so the form shows the room the schedule holds.
 */
export function offeredRooms(rooms: RoomOption[], schedule: Schedule): RoomOption[] {
  if (rooms.some((room) => room.id === schedule.roomId)) {
    return rooms;
  }
  const own = { id: schedule.roomId, name: schedule.roomName, officeName: schedule.officeName };
  return [own, ...rooms];
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
