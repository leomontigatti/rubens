import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";

import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";
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
    if (await action.save(() => finishSchedule({ data: input.data }))) {
      page.leave();
    }
  }

  return (
    <ActionFormPage
      page={page}
      title="Terminar horario"
      description={validityLabel(props.schedule)}
      submitLabel="Terminar horario"
      action={action}
      onSubmit={handleSubmit}
    >
      <Field>
        <FieldLabel htmlFor="schedule-end">Último día</FieldLabel>
        <Input
          id="schedule-end"
          name="lastDate"
          type="date"
          defaultValue={props.initial}
          required
        />
      </Field>
    </ActionFormPage>
  );
}
