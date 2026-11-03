import { createFileRoute } from "@tanstack/react-router";

import { useAppForm } from "#/components/app-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { scheduleEndSchema, validityLabel } from "#/lib/schedules.ts";
import { finishSchedule, getSchedules } from "#/server/schedules.functions.ts";
import type { Schedule } from "#/server/schedules.ts";

import { EditableSchedule } from "#/routes/_app/horarios/-schedule-form.tsx";
import { useAction } from "#/routes/_app/horarios/-shared.tsx";

export const Route = createFileRoute("/_app/horarios/$practitionerId_/$scheduleId/terminar")({
  loader: ({ params }) => getSchedules({ data: { practitionerId: params.practitionerId } }),
  head: () => ({ meta: [{ title: "Terminar horario · Rubens" }] }),
  component: EndSchedule,
});

function EndSchedule() {
  const result = Route.useLoaderData();
  const { scheduleId } = Route.useParams();
  return (
    <EditableSchedule result={result} scheduleId={scheduleId}>
      {(schedule, state) => <EndForm schedule={schedule} initial={state.endDefault} />}
    </EditableSchedule>
  );
}

function EndForm(props: { schedule: Schedule; initial: string }) {
  const { practitionerId } = Route.useParams();
  const page = useFormPage({ to: "/horarios/$practitionerId", params: { practitionerId } });
  const action = useAction();

  const form = useAppForm({
    defaultValues: { lastDate: props.initial },
    onSubmit: async ({ value }) => {
      const input = scheduleEndSchema.safeParse({ scheduleId: props.schedule.id, ...value });
      if (!input.success) {
        page.showProblems([{ field: "lastDate", message: "Ingresá el último día del horario." }]);
        return;
      }
      if (await action.save(() => finishSchedule({ data: input.data }))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title="Terminar horario"
      description={validityLabel(props.schedule)}
      submitLabel="Terminar horario"
      action={action}
    >
      <form.AppField name="lastDate">
        {(field) => <field.TextField label="Último día" type="date" required />}
      </form.AppField>
    </ActionFormPage>
  );
}
