import { createFileRoute } from "@tanstack/react-router";

import { scheduleChangeSchema, validityLabel } from "#/lib/schedules.ts";
import { editSchedule, getSchedules } from "#/server/schedules.functions.ts";

import {
  EditableSchedule,
  ScheduleForm,
  offeredRooms,
} from "#/routes/_app/horarios/-schedule-form.tsx";

export const Route = createFileRoute("/_app/horarios/$practitionerId_/$scheduleId/cambiar")({
  loader: ({ params }) => getSchedules({ data: { practitionerId: params.practitionerId } }),
  head: () => ({ meta: [{ title: "Cambiar horario · Rubens" }] }),
  component: ChangeSchedule,
});

function ChangeSchedule() {
  const result = Route.useLoaderData();
  const { practitionerId, scheduleId } = Route.useParams();
  return (
    <EditableSchedule result={result} scheduleId={scheduleId}>
      {(schedule, state) => (
        <ScheduleForm
          practitionerId={practitionerId}
          title="Cambiar horario"
          description={validityLabel(schedule)}
          rooms={offeredRooms(result.ok ? result.rooms : [], schedule)}
          initial={{ ...schedule, date: state.changeFrom }}
          dateLabel="El cambio rige desde"
          submitLabel="Guardar cambio"
          onSubmit={(fields) => {
            const input = scheduleChangeSchema.safeParse({
              scheduleId,
              from: fields.date,
              ...fields.rest,
            });
            return input.success ? editSchedule({ data: input.data }) : input.error;
          }}
        />
      )}
    </EditableSchedule>
  );
}
