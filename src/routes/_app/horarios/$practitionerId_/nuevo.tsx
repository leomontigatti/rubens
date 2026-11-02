import { createFileRoute } from "@tanstack/react-router";

import { scheduleInputSchema } from "#/lib/schedules.ts";
import { addSchedule, getSchedules } from "#/server/schedules.functions.ts";

import { ScheduleForm } from "#/routes/_app/horarios/-schedule-form.tsx";
import type { Initial } from "#/routes/_app/horarios/-schedule-form.tsx";
import { RefusalAlert } from "#/routes/_app/horarios/-shared.tsx";

export const Route = createFileRoute("/_app/horarios/$practitionerId_/nuevo")({
  loader: ({ params }) => getSchedules({ data: { practitionerId: params.practitionerId } }),
  head: () => ({ meta: [{ title: "Nuevo horario · Rubens" }] }),
  component: NewSchedule,
});

const emptyInitial: Initial = {
  roomId: "",
  weekdays: [],
  startTime: "",
  endTime: "",
  lastDate: null,
  date: "",
};

function NewSchedule() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return <RefusalAlert reason={result.reason} />;
  }
  const { practitioner, rooms } = result;
  if (!practitioner.canEdit || !practitioner.active) {
    return <RefusalAlert reason="forbidden" />;
  }
  return (
    <ScheduleForm
      practitionerId={practitioner.id}
      title="Nuevo horario"
      description={practitioner.displayName}
      rooms={rooms}
      initial={emptyInitial}
      dateLabel="Desde"
      submitLabel="Crear horario"
      onSubmit={(fields) => {
        const input = scheduleInputSchema.safeParse({
          practitionerId: practitioner.id,
          firstDate: fields.date,
          ...fields.rest,
        });
        return input.success ? addSchedule({ data: input.data }) : input.error;
      }}
    />
  );
}
